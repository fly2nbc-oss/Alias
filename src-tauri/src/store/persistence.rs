use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::error::AliasError;
use crate::store::alias_store::AliasStore;
use crate::types::StoreExport;

const STORE_FILE: &str = "alias_store.json";

fn store_path(app: &AppHandle) -> Result<PathBuf, AliasError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AliasError::Persistence(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(STORE_FILE))
}

pub fn save(app: &AppHandle, store: &AliasStore) -> Result<String, AliasError> {
    let path = store_path(app)?;
    let export = StoreExport {
        version: 1,
        created_at: chrono_now(),
        entries: store.list(),
    };
    let json = serde_json::to_string_pretty(&export)?;
    std::fs::write(&path, &json)?;
    Ok(path.to_string_lossy().to_string())
}

pub fn load(app: &AppHandle) -> Result<StoreExport, AliasError> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(StoreExport {
            version: 1,
            created_at: chrono_now(),
            entries: vec![],
        });
    }
    let json = std::fs::read_to_string(&path)?;
    let export: StoreExport = serde_json::from_str(&json)?;
    Ok(export)
}

pub fn load_on_startup(
    app: &AppHandle,
    store_mutex: &Mutex<AliasStore>,
) -> Result<(), AliasError> {
    let export = load(app)?;
    let mut store = store_mutex.lock().unwrap();
    store.import_entries(export.entries);
    Ok(())
}

pub fn load_from_path(path: &str) -> Result<StoreExport, AliasError> {
    let json = std::fs::read_to_string(path)?;
    let export: StoreExport = serde_json::from_str(&json)?;
    Ok(export)
}

pub fn save_to_path(path: &str, store: &AliasStore) -> Result<(), AliasError> {
    let export = StoreExport {
        version: 1,
        created_at: chrono_now(),
        entries: store.list(),
    };
    let json = serde_json::to_string_pretty(&export)?;
    std::fs::write(path, &json)?;
    Ok(())
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Einfaches ISO-ähnliches Format ohne externe Crate
    let s = secs;
    let min = s / 60;
    let hour = min / 60;
    let day_total = hour / 24;
    // Grobe Annäherung – exakter Wert nicht kritisch für Persistenz-Metadaten
    format!("unix:{}", day_total)
}
