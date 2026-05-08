use std::sync::Mutex;
use tauri::State;

use crate::store::alias_store::AliasStore;
use crate::substitutor::{decoder, encoder};
use crate::types::SubstitutionResult;

#[tauri::command]
pub fn encode_text(
    text: String,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<SubstitutionResult, String> {
    let s = store.lock().unwrap();
    Ok(encoder::encode(&text, &s))
}

#[tauri::command]
pub fn decode_text(
    text: String,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<SubstitutionResult, String> {
    let s = store.lock().unwrap();
    Ok(decoder::decode(&text, &s))
}

#[tauri::command]
pub fn preview_substitutions(
    text: String,
    mode: String,
    store: State<'_, Mutex<AliasStore>>,
) -> Result<Vec<[usize; 2]>, String> {
    let s = store.lock().unwrap();
    let entries: Vec<_> = s.entries.values().filter(|e| e.confirmed).collect();

    let search_terms: Vec<&str> = if mode == "decode" {
        entries.iter().map(|e| e.alias.as_str()).collect()
    } else {
        entries.iter().map(|e| e.original.as_str()).collect()
    };

    let mut offsets: Vec<[usize; 2]> = Vec::new();
    for term in search_terms {
        let escaped = regex::escape(term);
        if let Ok(re) = regex::Regex::new(&escaped) {
            for m in re.find_iter(&text) {
                offsets.push([m.start(), m.end()]);
            }
        }
    }
    offsets.sort_by_key(|o| o[0]);
    Ok(offsets)
}
