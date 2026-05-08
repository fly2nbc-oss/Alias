//! Gazetteer-basierter Locations-Detektor als Fallback wenn NER eine Stadt/Land nicht erkennt.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

use crate::types::{Category, EntityCandidate};

/// Bekannte Städte, Länder und Regionen die vom NER häufig übersehen werden.
static LOCATIONS: &[&str] = &[
    // Länder
    "Sweden", "Switzerland", "Austria", "Germany", "France", "Netherlands",
    "Belgium", "Denmark", "Norway", "Finland", "Poland", "Czech Republic",
    "United Kingdom", "United States", "Canada", "Australia", "Japan", "China",
    "Schweden", "Schweiz", "Österreich", "Deutschland", "Frankreich",
    "Niederlande", "Dänemark", "Norwegen", "Finnland",
    // Städte die NER oft nicht erkennt
    "Gothenburg", "Göteborg", "Malmö", "Uppsala",
    "Zurich", "Zürich", "Bern", "Basel", "Geneva", "Genf",
    "Antwerp", "Antwerpen", "Ghent", "Gent",
    "Eindhoven", "Utrecht", "Rotterdam",
    "Gdansk", "Krakow", "Kraków", "Wroclaw",
    "Bratislava", "Ljubljana", "Zagreb",
    "Tallinn", "Riga", "Vilnius",
    "Reykjavik",
];

static LOCATION_REGEX: Lazy<Regex> = Lazy::new(|| {
    // Escaped names, längste zuerst (damit "United Kingdom" vor "United" matcht)
    let mut sorted: Vec<&str> = LOCATIONS.to_vec();
    sorted.sort_by(|a, b| b.len().cmp(&a.len()));
    let pattern = sorted
        .iter()
        .map(|s| regex::escape(s))
        .collect::<Vec<_>>()
        .join("|");
    Regex::new(&format!(r"(?i)\b(?:{})\b", pattern)).unwrap()
});

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for m in LOCATION_REGEX.find_iter(text) {
        let raw = m.as_str().to_string();
        let entry = results.entry(raw.to_lowercase()).or_insert_with(|| {
            EntityCandidate::rule_base(raw.clone(), Category::Ort, 0.80, 0, vec![])
        });
        // Behalte Originalschreibweise des ersten Treffers
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    results.into_values().collect()
}
