//! Gemeinsame Normalisierung für Personen-Deduplizierung (Erkennung + `deduplicate`).

use crate::types::{Category, EntityCandidate};

fn is_title_token(word: &str) -> bool {
    let w = word.trim_matches(|c| c == '.' || c == ',' || c == ';');
    let wl = w.to_lowercase();
    matches!(
        wl.as_str(),
        "herr"
            | "frau"
            | "herrn"
            | "dr"
            | "prof"
            | "ing"
            | "mag"
            | "mr"
            | "mrs"
            | "ms"
            | "hr"
            | "fr"
            | "med"
    ) || wl.starts_with("dr.")
            || wl.starts_with("prof.")
            || wl == "dipl.-ing"
            || wl.starts_with("dipl.-ing.")
}

/// Führende Anreden/Titel entfernen; Ergebnis lowercased, ein Token pro Wort.
pub fn identity_key(full: &str) -> String {
    let tokens: Vec<&str> = full.split_whitespace().collect();
    let mut i = 0;
    while i < tokens.len() {
        let raw = tokens[i].trim_matches(|c| c == '.' || c == ',' || c == ';');
        if is_title_token(raw) {
            i += 1;
            continue;
        }
        break;
    }
    tokens[i..]
        .iter()
        .map(|t| {
            t.trim_matches(|c| c == '.' || c == ',' || c == ';')
                .to_lowercase()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_leading_title(full: &str) -> bool {
    full.split_whitespace()
        .next()
        .map(|t| is_title_token(t))
        .unwrap_or(false)
}

/// Welche Oberflächenform soll in der UI bleiben: möglichst langer Namenskern ohne Titel,
/// bei Gleichstand die Variante ohne führende Anrede.
pub fn choose_display_text(current: &str, incoming: &str) -> String {
    let kc = identity_key(current);
    let ki = identity_key(incoming);
    if kc.len() > ki.len() {
        return current.to_string();
    }
    if ki.len() > kc.len() {
        return incoming.to_string();
    }
    if has_leading_title(current) && !has_leading_title(incoming) {
        return incoming.to_string();
    }
    if !has_leading_title(current) && has_leading_title(incoming) {
        return current.to_string();
    }
    if incoming.len() > current.len() {
        return incoming.to_string();
    }
    current.to_string()
}

/// Zwei Personen-Kandidaten gelten als dieselbe Entität, wenn der Identitätsschlüssel
/// übereinstimmt und nicht leer ist (nach Entfernen reiner Titel-Zeilen).
pub fn same_person(a: &EntityCandidate, b: &EntityCandidate) -> bool {
    if a.category != Category::Person || b.category != Category::Person {
        return false;
    }
    let ka = identity_key(&a.text);
    let kb = identity_key(&b.text);
    !ka.is_empty() && ka == kb
}
