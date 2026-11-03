//! Trefferfindung für die Ersetzung in strukturierten Dateien (Office-XML).
//! Gleiche Semantik wie encoder/decoder (wörtlich, längste Einträge zuerst),
//! liefert aber Positionen statt eines fertigen Strings und verhindert Überlappungen.

use crate::office_xml::Match;
use crate::store::alias_store::AliasStore;

/// Ersetzungspaare (von → nach) für den Modus, längste zuerst.
pub fn pairs(store: &AliasStore, mode: &str) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = store
        .entries
        .values()
        .filter(|e| e.confirmed && !e.original.is_empty() && !e.alias.is_empty())
        .map(|e| {
            if mode == "encode" {
                (e.original.clone(), e.alias.clone())
            } else {
                (e.alias.clone(), e.original.clone())
            }
        })
        .collect();
    pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(&b.0)));
    pairs
}

/// Sortierte, nicht überlappende Treffer; längere Suchbegriffe haben Vorrang.
pub fn find_matches(text: &str, pairs: &[(String, String)]) -> Vec<Match> {
    let mut taken: Vec<Match> = Vec::new();
    for (from, to) in pairs {
        if !text.contains(from.as_str()) {
            continue;
        }
        for (p, _) in text.match_indices(from.as_str()) {
            let end = p + from.len();
            if taken.iter().all(|(s, e, _)| end <= *s || p >= *e) {
                taken.push((p, end, to.clone()));
            }
        }
    }
    taken.sort_by_key(|m| m.0);
    taken
}

/// Wendet die Treffer auf einen einfachen String an.
pub fn apply(text: &str, matches: &[Match]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (s, e, rep) in matches {
        out.push_str(&text[cursor..*s]);
        out.push_str(rep);
        cursor = *e;
    }
    out.push_str(&text[cursor..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_wins_no_overlap() {
        let pairs = vec![
            ("Max Mustermann".to_string(), "Person_1".to_string()),
            ("Max".to_string(), "Person_2".to_string()),
        ];
        let m = find_matches("Max Mustermann und Max", &pairs);
        assert_eq!(apply("Max Mustermann und Max", &m), "Person_1 und Person_2");
    }
}
