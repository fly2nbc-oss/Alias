use once_cell::sync::Lazy;
use std::collections::HashSet;

static FIRST_NAMES_RAW: &str = include_str!("../../data/first_names.txt");
static NAME_EXCLUSIONS_RAW: &str = include_str!("../../data/name_exclusions.txt");

pub static FIRST_NAMES: Lazy<HashSet<String>> = Lazy::new(|| {
    FIRST_NAMES_RAW
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|s| s.to_string())
        .collect()
});

/// PRD: Vornamen, die oft kein Personenname sind — Schicht C nur mit Zusatzsignal.
pub static NAME_EXCLUSIONS: Lazy<HashSet<String>> = Lazy::new(|| {
    NAME_EXCLUSIONS_RAW
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|s| s.to_string())
        .collect()
});

/// Prüft, ob `word` (oder ein Bindestrich-Segment wie bei Hans-Peter) als Vorname in der Liste vorkommt.
pub fn looks_like_known_first_name(word: &str) -> bool {
    let w = word.trim_matches(|c| c == '.' || c == ',' || c == ';');
    if FIRST_NAMES.contains(w) {
        return true;
    }
    for part in w.split('-').map(str::trim).filter(|p| !p.is_empty()) {
        if FIRST_NAMES.contains(part) {
            return true;
        }
    }
    false
}

/// PRD-Ausschlussliste (nur zusammen mit Titel- oder Kontext-Schicht matchen).
pub fn is_exclusion_first_name(word: &str) -> bool {
    let w = word.trim_matches(|c| c == '.' || c == ',' || c == ';');
    NAME_EXCLUSIONS.contains(w)
}
