use std::path::PathBuf;

use crate::detector::{self, person_ner};
use crate::types::EntityCandidate;
use serde::Serialize;

/// Stable display path for tooltips (Windows: avoid mixed `\` and `/`).
fn models_dir_display(p: PathBuf) -> String {
    let s = p.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        s.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        s
    }
}

#[tauri::command]
pub async fn detect_entities(text: String) -> Result<Vec<EntityCandidate>, String> {
    Ok(detector::detect_all(&text))
}

#[derive(Serialize)]
pub struct NerStatus {
    pub models_dir: Option<String>,
    pub model_onnx: bool,
    pub tokenizer_json: bool,
    pub ner_labels_json: bool,
    pub engine_loaded: bool,
    pub test_results: Vec<String>,
    pub ready: bool,
}

#[tauri::command]
pub fn ner_status() -> NerStatus {
    let dir = person_ner::MODELS_DIR.lock().ok().and_then(|g| g.clone());

    let file = |name: &str| dir.as_ref().map_or(false, |p| p.join(name).is_file());
    let (model_onnx, tokenizer_json, ner_labels_json) = (
        file("model.onnx"), file("tokenizer.json"), file("ner_labels.json"),
    );
    let files_ok = model_onnx && tokenizer_json && ner_labels_json;

    #[cfg(feature = "onnx-ner")]
    let (engine_loaded, test_results) = if files_ok {
        person_ner::engine::diagnose_ner()
    } else {
        (false, vec!["Model files missing".into()])
    };
    #[cfg(not(feature = "onnx-ner"))]
    let (engine_loaded, test_results) = (false, vec!["onnx-ner not compiled".into()]);

    NerStatus {
        models_dir: dir.map(models_dir_display),
        model_onnx, tokenizer_json, ner_labels_json, engine_loaded, test_results,
        ready: files_ok && engine_loaded,
    }
}
