//! Lädt das NER-Modell einmalig aus dem Internet in AppData herunter.
//! Emittiert Fortschritts-Events an das Frontend.

use std::io::Write;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const MODEL_URL: &str = "https://huggingface.co/Xenova/bert-base-multilingual-cased-ner-hrl/resolve/main/onnx/model_quantized.onnx";
const TOKENIZER_URL: &str = "https://huggingface.co/Xenova/bert-base-multilingual-cased-ner-hrl/resolve/main/tokenizer.json";

pub const NER_LABELS_JSON: &str = r#"{"model_id":"Xenova/bert-base-multilingual-cased-ner-hrl","labels":["O","B-DATE","I-DATE","B-PER","I-PER","B-ORG","I-ORG","B-LOC","I-LOC"]}"#;

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DownloadError {
    pub message: String,
}

/// Lädt model_quantized.onnx + tokenizer.json in `dest` herunter.
/// Emittiert `ner-download-progress` und am Ende `ner-download-complete` oder `ner-download-error`.
pub async fn download_models(app: AppHandle, dest: PathBuf) {
    if let Err(e) = try_download(&app, &dest).await {
        let _ = app.emit("ner-download-error", DownloadError { message: e });
    }
}

async fn try_download(app: &AppHandle, dest: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Directory: {e}"))?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    download_file(app, &client, MODEL_URL, &dest.join("model.onnx"), "Model").await?;
    download_file(app, &client, TOKENIZER_URL, &dest.join("tokenizer.json"), "Tokenizer").await?;

    // ner_labels.json eingebettet — kein Download nötig
    std::fs::write(dest.join("ner_labels.json"), NER_LABELS_JSON)
        .map_err(|e| format!("Write labels: {e}"))?;

    let _ = app.emit("ner-download-complete", ());
    Ok(())
}

async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    phase: &str,
) -> Result<(), String> {
    let tmp = dest.with_extension("tmp");

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{phase} download: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("{phase}: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut last_percent = 255u8;

    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("{phase} create file: {e}"))?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("{phase} stream: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("{phase} write: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 { (downloaded * 100 / total) as u8 } else { 0 };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "ner-download-progress",
                DownloadProgress { phase: phase.into(), downloaded, total, percent },
            );
        }
    }

    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| format!("{phase} rename: {e}"))?;
    Ok(())
}
