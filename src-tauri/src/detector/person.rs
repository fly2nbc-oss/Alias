use std::collections::hash_map::Entry;
use std::collections::HashMap;

use crate::detector::gazetteer;
use crate::detector::person_identity;
use crate::detector::patterns::{
    PERSON_CONTEXT_REGEX, PERSON_GREETING_REGEX, PERSON_LIEBE_REGEX, PERSON_NON_NAME_TAIL_WORDS,
    PERSON_REGEX, PERSON_SUFFIX_STOPWORDS, PERSON_TITLE_REGEX, PERSON_STOPWORDS,
};
use crate::types::{Category, DetectionSource, EntityCandidate};

fn is_particle(w: &str) -> bool {
    matches!(
        w.to_lowercase().as_str(),
        "van" | "von" | "de" | "der" | "den" | "zum" | "zur"
    )
}

/// Erstes Wort, das kein Namenspartikel ist (für Gazetteer-Abgleich).
fn first_substantive_token<'a>(words: &[&'a str]) -> Option<&'a str> {
    for w in words {
        let t = w.trim_matches(|c| c == '.' || c == ',' || c == ';');
        if !is_particle(t) {
            return Some(t);
        }
    }
    None
}

fn has_stopword(words: &[&str]) -> bool {
    words.iter().any(|w| PERSON_STOPWORDS.contains(*w))
}

/// Entfernt vom Ende Kalender-/UI-/Rollen- und andere typische Nicht-Nachnamen-Token.
/// Erlaubt Kürzung auf **einen** Vornamen (z. B. „Dietmar Unterstützung“ → „Dietmar“).
fn trim_layer_c_trailing_non_person_words(mut words: Vec<&str>) -> Vec<&str> {
    while words.len() > 1 {
        let last = words.last().unwrap().trim_matches(|c| c == '.' || c == ',' || c == ';');
        if PERSON_SUFFIX_STOPWORDS.contains(last) || PERSON_NON_NAME_TAIL_WORDS.contains(last) {
            words.pop();
        } else {
            break;
        }
    }
    words
}

/// Byte-Ende im Quellstring nach `n` Wörtern (Whitespace im Original beibehalten).
fn byte_end_after_n_words(s: &str, n: usize) -> usize {
    if n == 0 || s.is_empty() {
        return 0;
    }
    let mut words_seen = 0;
    let mut i = 0;
    while i < s.len() {
        let mut it = s[i..].chars();
        let c = match it.next() {
            Some(ch) => ch,
            None => break,
        };
        if c.is_whitespace() {
            i += c.len_utf8();
            continue;
        }
        words_seen += 1;
        i += c.len_utf8();
        while i < s.len() {
            let ch = s[i..].chars().next().unwrap();
            if ch.is_whitespace() {
                break;
            }
            i += ch.len_utf8();
        }
        if words_seen == n {
            return i;
        }
    }
    s.len()
}

fn insert_name(
    results: &mut HashMap<String, EntityCandidate>,
    text: &str,
    range: std::ops::Range<usize>,
    confidence: f32,
    source: DetectionSource,
) {
    let matched_text = text[range.start..range.end].to_string();
    let words: Vec<&str> = matched_text.split_whitespace().collect();
    if has_stopword(&words) {
        return;
    }
    if words.is_empty() {
        return;
    }
    let key = person_identity::identity_key(&matched_text);
    if key.is_empty() {
        return;
    }

    match results.entry(key) {
        Entry::Vacant(v) => {
            v.insert(EntityCandidate {
                text: matched_text,
                category: Category::Person,
                confidence,
                occurrences: 1,
                offsets: vec![[range.start, range.end]],
                detection_source: source,
                needs_review: false,
                features: std::collections::HashMap::new(),
            });
        }
        Entry::Occupied(mut o) => {
            let e = o.get_mut();
            e.occurrences += 1;
            e.offsets.push([range.start, range.end]);
            e.text = person_identity::choose_display_text(&e.text, &matched_text);
            if confidence > e.confidence {
                e.confidence = confidence;
            }
            e.detection_source =
                DetectionSource::merge_prefer_stronger(e.detection_source.clone(), source.clone());
        }
    }
}

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    // Schicht A — Titel / Anrede
    for cap in PERSON_TITLE_REGEX.captures_iter(text) {
        let m = cap.get(1).expect("PERSON_TITLE_REGEX group 1");
        insert_name(
            &mut results,
            text,
            m.start()..m.end(),
            0.9,
            DetectionSource::Rule,
        );
    }

    // Schicht B — Kontext
    for cap in PERSON_CONTEXT_REGEX.captures_iter(text) {
        let m = cap.get(1).expect("PERSON_CONTEXT_REGEX group 1");
        insert_name(
            &mut results,
            text,
            m.start()..m.end(),
            0.84,
            DetectionSource::Rule,
        );
    }
    for cap in PERSON_GREETING_REGEX.captures_iter(text) {
        let m = cap.get(1).unwrap();
        insert_name(
            &mut results,
            text,
            m.start()..m.end(),
            0.82,
            DetectionSource::Rule,
        );
    }
    for cap in PERSON_LIEBE_REGEX.captures_iter(text) {
        let m = cap.get(1).unwrap();
        insert_name(
            &mut results,
            text,
            m.start()..m.end(),
            0.83,
            DetectionSource::Rule,
        );
    }

    // Schicht C — Gazetteer + Nachname (Suffix trimmen, damit keine UI-Wörter am Namen hängen)
    for cap in PERSON_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        let full_str = full_match.as_str();
        let mut words: Vec<&str> = full_str.split_whitespace().collect();
        if has_stopword(&words) {
            continue;
        }
        if words.len() < 2 {
            continue;
        }
        let Some(token) = first_substantive_token(&words) else {
            continue;
        };
        if !gazetteer::looks_like_known_first_name(token) {
            continue;
        }
        if gazetteer::is_exclusion_first_name(token) {
            continue;
        }

        words = trim_layer_c_trailing_non_person_words(words);
        if words.is_empty() {
            continue;
        }
        let conf = if words.len() >= 2 {
            0.78
        } else {
            0.72
        };
        let n = words.len();
        let end_rel = byte_end_after_n_words(full_str, n);
        let start = full_match.start();
        let end = start + end_rel;

        insert_name(
            &mut results,
            text,
            start..end,
            conf,
            DetectionSource::Lexicon,
        );
    }

    results.into_values().collect()
}
