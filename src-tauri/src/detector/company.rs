use crate::detector::patterns::{
    ABBREV_STOPWORDS, ACRONYM_SPACE_FIRMA_REGEX, COMPANY_REGEX, COMPANY_SIGNAL_REGEX,
    HYPHENATED_FIRMA_REGEX,
};
use crate::types::{Category, EntityCandidate};

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: std::collections::HashMap<String, EntityCandidate> =
        std::collections::HashMap::new();

    for cap in COMPANY_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        let matched_text = full_match.as_str().to_string();

        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Firma,
            0.95,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([full_match.start(), full_match.end()]);
    }

    for cap in COMPANY_SIGNAL_REGEX.captures_iter(text) {
        let m = cap.get(1).expect("COMPANY_SIGNAL_REGEX capture 1");
        let matched_text = m.as_str().to_string();

        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Firma,
            0.82,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    for cap in HYPHENATED_FIRMA_REGEX.captures_iter(text) {
        let m = cap.get(1).expect("HYPHENATED_FIRMA_REGEX capture 1");
        let matched_text = m.as_str().to_string();

        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Firma,
            0.88,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    for cap in ACRONYM_SPACE_FIRMA_REGEX.captures_iter(text) {
        let m = cap.get(1).expect("ACRONYM_SPACE_FIRMA_REGEX capture 1");
        let matched_text = m.as_str().to_string();
        if let Some(first) = matched_text.split_whitespace().next() {
            if ABBREV_STOPWORDS.contains(first) {
                continue;
            }
        }

        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Firma,
            0.86,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    results.into_values().collect()
}
