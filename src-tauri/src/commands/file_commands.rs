use std::sync::Mutex;
use tauri::State;

use crate::parser;
use crate::store::alias_store::AliasStore;
use crate::substitutor::file_copy;
use crate::types::ParsedDocument;

#[tauri::command]
pub async fn open_file(path: String) -> Result<ParsedDocument, String> {
    parser::parse_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    _store: State<'_, Mutex<AliasStore>>,
) -> Result<Option<ParsedDocument>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter(
            "Supported documents",
            &["txt", "md", "docx", "xlsx", "xls", "xlsm"],
        )
        .blocking_pick_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            let doc = parser::parse_file(&path_str).map_err(|e| e.to_string())?;
            Ok(Some(doc))
        }
        None => Ok(None),
    }
}

/// Erstellt eine Kopie der Originaldatei (gleicher Ordner, `_anonym`/`_original`-Suffix)
/// mit angewandten Alias-Ersetzungen — behält das Originalformat (.txt, .docx, .xlsx).
#[tauri::command]
pub fn save_file_copy(
    source_path: String,
    mode: String,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<String, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    file_copy::save_copy(&source_path, &mode, &store)
}

/// Save result text (encoded/decoded) via dialog as a UTF-8 file.
#[tauri::command]
pub async fn save_text_as_dialog(
    app: tauri::AppHandle,
    content: String,
    default_file_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let default = default_file_name.unwrap_or_else(|| "result.txt".to_string());
    let path = app
        .dialog()
        .file()
        .add_filter("Text files", &["txt", "md"])
        .set_file_name(&default)
        .blocking_save_file();

    match path {
        Some(p) => {
            let path_str = p.to_string();
            std::fs::write(&path_str, content).map_err(|e| e.to_string())?;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}
