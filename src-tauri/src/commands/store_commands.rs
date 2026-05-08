use std::sync::Mutex;
use tauri::State;

use crate::store::alias_store::AliasStore;
use crate::store::persistence;
use crate::types::{AliasEntry, BulkAddItem, Category};

#[tauri::command]
pub fn get_store(store: State<'_, Mutex<AliasStore>>) -> Vec<AliasEntry> {
    store.lock().unwrap().list()
}

#[tauri::command]
pub fn add_entry(
    original: String,
    alias: Option<String>,
    category: Category,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<AliasEntry, String> {
    store
        .lock()
        .unwrap()
        .add(original, alias, category)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_entries_bulk(
    items: Vec<BulkAddItem>,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<Vec<AliasEntry>, String> {
    store
        .lock()
        .unwrap()
        .add_bulk(items)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_entry(
    id: String,
    alias: Option<String>,
    category: Option<Category>,
    confirmed: Option<bool>,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<AliasEntry, String> {
    store
        .lock()
        .unwrap()
        .update(&id, alias, category, confirmed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_entry(id: String, store: State<'_, Mutex<AliasStore>>) -> Result<(), String> {
    store
        .lock()
        .unwrap()
        .remove(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_store(store: State<'_, Mutex<AliasStore>>) {
    store.lock().unwrap().clear();
}

#[tauri::command]
pub fn get_auto_alias(text: String, category: Category, store: State<'_, Mutex<AliasStore>>) -> String {
    let _ = text; // API consistency; unused
    store.lock().unwrap().preview_alias(&category)
}

#[tauri::command]
pub fn save_store(
    path: Option<String>,
    app: tauri::AppHandle,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<String, String> {
    let s = store.lock().unwrap();
    match path {
        Some(p) => {
            persistence::save_to_path(&p, &s).map_err(|e| e.to_string())?;
            Ok(p)
        }
        None => persistence::save(&app, &s).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn load_store(
    path: String,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<Vec<AliasEntry>, String> {
    let export = persistence::load_from_path(&path).map_err(|e| e.to_string())?;
    let mut s = store.lock().unwrap();
    s.import_entries(export.entries);
    Ok(s.list())
}

#[tauri::command]
pub async fn export_store_dialog(
    app: tauri::AppHandle,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("alias_store.json")
        .blocking_save_file();

    match path {
        Some(p) => {
            let path_str = p.to_string();
            let s = store.lock().unwrap();
            persistence::save_to_path(&path_str, &s).map_err(|e| e.to_string())?;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn import_store_dialog(
    app: tauri::AppHandle,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<Option<Vec<AliasEntry>>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    match file {
        Some(p) => {
            let path_str = p.to_string();
            let export = persistence::load_from_path(&path_str).map_err(|e| e.to_string())?;
            let mut s = store.lock().unwrap();
            s.import_entries(export.entries);
            Ok(Some(s.list()))
        }
        None => Ok(None),
    }
}
