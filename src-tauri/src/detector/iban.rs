use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::types::{Category, EntityCandidate};

/// IBAN-ähnliche Folge (optional Leerzeichen/Tab, kein Newline);
/// Feinfilter über Länge + Mod-97.
/// `[ \t]?` statt `\s?` verhindert, dass die Regex über Zeilengrenzen läuft
/// und dadurch die Checksummenprüfung mit Fremdzeichen fehlschlägt.
pub static IBAN_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){11,30}\b").unwrap()
});

/// Modulo-97-Prüfung (ISO 13616); `iban` darf Leerzeichen enthalten.
pub fn iban_checksum_valid(iban: &str) -> bool {
    let compact: String = iban.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if compact.len() < 15 || compact.len() > 34 {
        return false;
    }
    let upper = compact.to_ascii_uppercase();
    if upper.len() < 4 || !upper[..2].chars().all(|c| c.is_ascii_uppercase()) {
        return false;
    }
    let rearranged = format!("{}{}", &upper[4..], &upper[..4]);
    let mut rem: u32 = 0;
    for ch in rearranged.chars() {
        if ch.is_ascii_digit() {
            let v = (ch as u32) - (b'0' as u32);
            rem = (rem * 10 + v) % 97;
        } else if ch.is_ascii_uppercase() {
            let v = (ch as u32) - (b'A' as u32) + 10;
            rem = (rem * 100 + v) % 97;
        } else {
            return false;
        }
    }
    rem == 1
}

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for m in IBAN_REGEX.find_iter(text) {
        let raw = m.as_str();
        let compact_len = raw.chars().filter(|c| c.is_ascii_alphanumeric()).count();
        if compact_len < 15 || compact_len > 34 {
            continue;
        }
        if !iban_checksum_valid(raw) {
            continue;
        }
        let matched_text = raw.to_string();
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Iban,
            0.97,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    results.into_values().collect()
}
