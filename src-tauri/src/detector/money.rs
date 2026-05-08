//! Geldbetrag-Detektor — erkennt Währungsangaben wie „284.500 €", „$10", „10 USD".
//! Erkennt: Präfix-Symbol ($10, €500), Suffix-Symbol (500€, 500 €),
//!          Suffix-Wort (284.500 Euro, 10 USD), Präfix-ISO-Code (EUR 500).

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

use crate::types::{Category, EntityCandidate};

/// Zahl: Ziffern mit optionalen Tausendertrenner (Punkt oder Komma) und Dezimalstellen.
/// Matcht: 284.500 / 1,000 / 284.500,00 / 1000.00 / 10
const NUM: &str = r"\d[\d.,]*";

/// $10  €284.500  £1.000 — Währungssymbol direkt vor der Zahl
static RE_PREFIX_SYMBOL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"[$€£¥]\s?{NUM}")).unwrap()
});

/// 284.500€  1.000 €  500 £ — Symbol direkt hinter der Zahl (mit optionalem Leerzeichen)
static RE_SUFFIX_SYMBOL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"{NUM}\s?[$€£¥]")).unwrap()
});

/// 284.500 Euro  10 USD  1.000 CHF — ISO-Kürzel oder ausgeschriebene Währung hinter der Zahl
static RE_SUFFIX_WORD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i){NUM}\s+(?:Euro|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF|Franken?|Pfund|Dollar|Pounds?)\b"
    )).unwrap()
});

/// EUR 1.000  USD 500 — ISO-Kürzel vor der Zahl
static RE_PREFIX_WORD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF)\s+{NUM}\b"
    )).unwrap()
});

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for re in &[
        &*RE_PREFIX_SYMBOL,
        &*RE_SUFFIX_SYMBOL,
        &*RE_SUFFIX_WORD,
        &*RE_PREFIX_WORD,
    ] {
        for m in re.find_iter(text) {
            let raw = m.as_str().trim().to_string();
            // Mindeststellen: Beträge mit weniger als 2 Ziffern überspringen (z.B. "1$" = ok, aber ".$" nicht)
            let digit_count = raw.chars().filter(|c| c.is_ascii_digit()).count();
            if digit_count < 1 {
                continue;
            }
            let key = raw.clone();
            let entry = results.entry(key).or_insert_with(|| {
                EntityCandidate::rule_base(raw.clone(), Category::Betrag, 0.92, 0, vec![])
            });
            entry.occurrences += 1;
            entry.offsets.push([m.start(), m.end()]);
        }
    }

    results.into_values().collect()
}
