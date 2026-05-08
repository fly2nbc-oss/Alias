use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::types::{Category, EntityCandidate};

/// PRD-kombiniertes Muster (international, Klammern, Bindestriche).
/// Zwei Alternativen im Präfix: mit führendem + oder Wortgrenze.
/// `(?:[\s./-]\d+)+` matcht beliebig viele Trailing-Gruppen vollständig.
static PHONE_MAIN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?:\+\d{1,3}[\s./-]?|\b\d{1,3}[\s./-]?)(?:\(\d{2,5}\)|\d{2,5})(?:[\s./-]\d+)+\b",
    )
    .unwrap()
});

/// Kompakte deutsche Nummern (z. B. 017012345678, 0754112345).
static PHONE_COMPACT_DE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b0\d{9,14}\b").unwrap());

/// Datumsähnliche Muster (DD.MM.YYYY / DD.MM.YY / DD/MM/YYYY) — keine Telefonnummern.
static DATE_LIKE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$").unwrap()
});

fn digit_count(s: &str) -> usize {
    s.chars().filter(|c| c.is_ascii_digit()).count()
}

/// PRD: 6–15 Ziffern; keine bloßen Kurzzahlenketten ohne typische Telefonform.
fn plausible_phone(raw: &str) -> bool {
    // Datumsformate (DD.MM.YYYY etc.) explizit ausschließen
    if DATE_LIKE.is_match(raw.trim()) {
        return false;
    }
    let d = digit_count(raw);
    if !(6..=15).contains(&d) {
        return false;
    }
    let only_digits = raw.chars().all(|c| c.is_ascii_digit() || c.is_whitespace());
    if only_digits {
        let compact: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
        // Sehr kurze reine Ziffernfolgen ablehnen (kein führendes 0-Mobil/VoIP-Muster)
        if compact.len() < 10 {
            return compact.starts_with("015")
                || compact.starts_with("016")
                || compact.starts_with("017")
                || compact.starts_with("0157")
                || compact.starts_with("0137");
        }
    }
    true
}

fn confidence_with_context(text: &str, start: usize, _end: usize) -> f32 {
    // `start` ist ein UTF-8-Wortgrenzen-Index; `start - 100` kann mitten in einem Zeichen liegen → Panic ohne floor_char_boundary
    let lookback_raw = start.saturating_sub(100);
    let lookback_start = text.floor_char_boundary(lookback_raw);
    let prefix = text[lookback_start..start].to_lowercase();
    const KEYS: &[&str] = &[
        "tel.",
        "telefon",
        " fon",
        "mobil",
        "handy",
        "fax",
        "rufnummer",
        "erreichbar unter",
        " ruf ",
        "tel ",
    ];
    if KEYS.iter().any(|k| prefix.contains(k)) {
        0.92
    } else {
        0.84
    }
}

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for m in PHONE_MAIN.find_iter(text) {
        let raw = m.as_str();
        if !plausible_phone(raw) {
            continue;
        }
        let matched_text = raw.to_string();
        let conf = confidence_with_context(text, m.start(), m.end());
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Telefon,
            conf,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
        if conf > entry.confidence {
            entry.confidence = conf;
        }
    }

    for m in PHONE_COMPACT_DE.find_iter(text) {
        let raw = m.as_str();
        if !plausible_phone(raw) {
            continue;
        }
        let matched_text = raw.to_string();
        let conf = confidence_with_context(text, m.start(), m.end());
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Telefon,
            conf,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
        if conf > entry.confidence {
            entry.confidence = conf;
        }
    }

    let mut out: Vec<EntityCandidate> = results.into_values().collect();
    for e in &mut out {
        e.offsets.sort_by_key(|o| o[0]);
        e.offsets.dedup();
        e.occurrences = e.offsets.len();
    }
    out
}
