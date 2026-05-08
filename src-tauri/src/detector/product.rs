use std::collections::{HashMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::detector::patterns::{QUOTED_REGEX, TRADEMARK_REGEX};
use crate::types::{Category, DetectionSource, EntityCandidate};

static BRANDS_RAW: &str = include_str!("../../data/brands.txt");

fn brand_pattern_alternation() -> String {
    BRANDS_RAW
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|s| regex::escape(s))
        .collect::<Vec<_>>()
        .join("|")
}

/// PRD Schicht A: Markenliste, Wortgrenzen, case-insensitive
pub static BRAND_REGEX: Lazy<Regex> = Lazy::new(|| {
    let alt = brand_pattern_alternation();
    if alt.is_empty() {
        return Regex::new("a^").expect("empty brand regex placeholder");
    }
    Regex::new(&format!(r"(?i)\b(?:{})\b", alt)).expect("brand list regex")
});

/// PRD Schicht B: Produktcode-Heuristik
static PRODUCT_CODE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b[A-Z][A-Za-z]*\s?[A-Z]?\d{1,4}[a-zA-Z]?\b").unwrap()
});

static PRODUCT_CODE_EXCLUDE: Lazy<HashSet<String>> = Lazy::new(|| {
    [
        "A0", "A1", "A2", "A3", "A4", "A5", "A6", "B0", "B1", "B2", "B3", "B4", "B5", "B6",
    ]
    .into_iter()
    .map(String::from)
    .collect()
});

/// PRD Schicht C: Kontext „Modell“, „Produkt“, … + Kandidat (ohne Lookahead — nicht im `regex`-Crate)
static PRODUCT_CONTEXT_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:Modell|Produkt|Typ|Gerät|Marke|Software|Version|Fahrzeug)\s+[:.]?\s*([A-ZÄÖÜ0-9][^,;.\n]{1,48})",
    )
    .unwrap()
});

fn plausible_product_code(m: &str) -> bool {
    let t = m.trim();
    if t.len() < 2 || t.len() > 24 {
        return false;
    }
    if PRODUCT_CODE_EXCLUDE.contains(t) {
        return false;
    }
    true
}

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for m in BRAND_REGEX.find_iter(text) {
        let matched_text = m.as_str().to_string();
        let entry = results.entry(matched_text.clone()).or_insert_with(|| {
            let mut e = EntityCandidate::rule_base(
                matched_text.clone(),
                Category::Produkt,
                0.9,
                0,
                vec![],
            );
            e.detection_source = DetectionSource::Lexicon;
            e
        });
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    for m in PRODUCT_CODE_REGEX.find_iter(text) {
        let raw = m.as_str();
        if !plausible_product_code(raw) {
            continue;
        }
        let matched_text = raw.to_string();
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Produkt,
            0.72,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    for cap in PRODUCT_CONTEXT_REGEX.captures_iter(text) {
        let inner = cap.get(1).unwrap().as_str().trim();
        if inner.len() < 2 {
            continue;
        }
        let m = cap.get(0).unwrap();
        let matched_text = inner.to_string();
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Produkt,
            0.76,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    for cap in QUOTED_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        let inner = cap.get(1).unwrap().as_str().trim().to_string();
        if inner.is_empty() {
            continue;
        }
        let entry = results.entry(inner.clone()).or_insert(EntityCandidate::rule_base(
            inner.clone(),
            Category::Produkt,
            0.8,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([full_match.start(), full_match.end()]);
    }

    for cap in TRADEMARK_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        let inner = cap.get(1).unwrap().as_str().trim().to_string();
        if inner.is_empty() {
            continue;
        }
        let entry = results.entry(inner.clone()).or_insert(EntityCandidate::rule_base(
            inner.clone(),
            Category::Produkt,
            0.85,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([full_match.start(), full_match.end()]);
    }

    results.into_values().collect()
}
