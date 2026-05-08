mod commands;
mod detector;
mod error;
mod parser;
mod store;
mod substitutor;
mod types;

use std::sync::Mutex;
use store::alias_store::AliasStore;
use tauri::{Emitter, Manager};

/// Startet den NER-Modell-Download in einem Hintergrund-Task.
/// Nach Abschluss wird `bootstrap_models_directory` erneut aufgerufen.
fn spawn_ner_download(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let dest = match detector::person_ner::appdata_ner_dir(&app) {
            Some(p) => p,
            None => {
                let _ = app.emit(
                    "ner-download-error",
                    detector::person_ner::downloader::DownloadError {
                        message: "Could not resolve AppData directory".into(),
                    },
                );
                return;
            }
        };
        detector::person_ner::downloader::download_models(app.clone(), dest).await;
        // Nach Download: MODELS_DIR setzen und Engine vorladen
        detector::person_ner::bootstrap_models_directory(&app);
        std::thread::spawn(|| {
            detector::person_ner::prewarm_engine();
        });
    });
}

/// Tauri-Command: Download manuell anstoßen (z. B. nach Netzwerkfehler).
#[tauri::command]
async fn download_ner_model(app: tauri::AppHandle) {
    spawn_ner_download(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let alias_store = Mutex::new(AliasStore::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(alias_store)
        .setup(|app| {
            #[cfg(desktop)]
            {
                if detector::person_ner::needs_download(app.handle()) {
                    // Modell fehlt → automatisch herunterladen
                    spawn_ner_download(app.handle().clone());
                } else {
                    // Modell vorhanden → Pfad setzen
                    detector::person_ner::bootstrap_models_directory(app.handle());
                    // ONNX-Engine asynchron vorwärmen: erster Detect-Klick reagiert sofort
                    std::thread::spawn(|| {
                        detector::person_ner::prewarm_engine();
                    });
                }
            }
            let store = app.state::<Mutex<AliasStore>>();
            if let Err(e) = store::persistence::load_on_startup(app.handle(), &store) {
                eprintln!("Could not load store: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            download_ner_model,
            commands::file_commands::open_file,
            commands::file_commands::open_file_dialog,
            commands::file_commands::save_file_copy,
            commands::file_commands::save_text_as_dialog,
            commands::detect_commands::detect_entities,
            commands::detect_commands::ner_status,
            commands::store_commands::get_store,
            commands::store_commands::add_entry,
            commands::store_commands::add_entries_bulk,
            commands::store_commands::update_entry,
            commands::store_commands::remove_entry,
            commands::store_commands::clear_store,
            commands::store_commands::get_auto_alias,
            commands::store_commands::save_store,
            commands::store_commands::load_store,
            commands::store_commands::export_store_dialog,
            commands::store_commands::import_store_dialog,
            commands::process_commands::encode_text,
            commands::process_commands::decode_text,
            commands::process_commands::preview_substitutions,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Alias app");
}
