//! Offline Personen-NER über ONNX Token-Classification (BIO) + Hugging-Face-Tokenizer.
//! Fehlende Modelldateien werden beim Start automatisch heruntergeladen.

#[cfg(feature = "onnx-ner")]
pub(crate) mod engine;
pub(crate) mod downloader;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub(crate) static MODELS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

const MODEL_FILES: [&str; 3] = ["model.onnx", "tokenizer.json", "ner_labels.json"];

pub fn set_models_directory(p: PathBuf) {
    if let Ok(mut g) = MODELS_DIR.lock() {
        *g = Some(p);
    }
    #[cfg(feature = "onnx-ner")]
    engine::reset_engine_cache();
}

/// Gibt das AppData-Verzeichnis für NER-Modelle zurück.
pub fn appdata_ner_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("models").join("ner"))
}

fn has_all_files(p: &PathBuf) -> bool {
    MODEL_FILES.iter().all(|f| p.join(f).is_file())
}

/// Prüft ob Modelldateien fehlen und ein Download nötig ist.
/// Berücksichtigt Env-Var und AppData.
pub fn needs_download(app: &tauri::AppHandle) -> bool {
    if std::env::var("ALIAS_NER_MODEL_DIR").is_ok() {
        return false; // explizit gesetzt → kein Auto-Download
    }
    appdata_ner_dir(app).map_or(true, |p| !has_all_files(&p))
}

/// Setzt MODELS_DIR wenn Dateien in AppData vorhanden sind.
pub fn bootstrap_models_directory(app: &tauri::AppHandle) {
    // Env-Var hat Vorrang
    if let Some(dir) = std::env::var("ALIAS_NER_MODEL_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(has_all_files)
    {
        set_models_directory(dir);
        return;
    }

    // AppData
    if let Some(dir) = appdata_ner_dir(app).filter(has_all_files) {
        set_models_directory(dir);
    }
}

/// Engine im Hintergrund vorwärmen — blockiert, muss in eigenem Thread aufgerufen werden.
/// Wird im Setup-Hook gespawnt damit der erste Detect-Klick sofort reagiert.
pub fn prewarm_engine() {
    #[cfg(feature = "onnx-ner")]
    engine::prewarm();
}

/// Primärsignal: lokales NER, falls Modell vorhanden; sonst leer.
pub fn detect_all_entities_ner(text: &str) -> Vec<crate::types::EntityCandidate> {
    #[cfg(feature = "onnx-ner")]
    {
        return engine::detect_with_optional_model(text);
    }
    #[cfg(not(feature = "onnx-ner"))]
    {
        let _ = text;
        vec![]
    }
}
