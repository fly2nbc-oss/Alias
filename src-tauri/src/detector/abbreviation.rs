use crate::detector::patterns::{ABBREV_REGEX, ABBREV_STOPWORDS};
use crate::types::{Category, EntityCandidate};

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: std::collections::HashMap<String, EntityCandidate> =
        std::collections::HashMap::new();

    for cap in ABBREV_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        let matched_text = full_match.as_str().to_string();

        if ABBREV_STOPWORDS.contains(&matched_text) {
            continue;
        }

        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Sonstiges,
            0.65,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([full_match.start(), full_match.end()]);
    }

    results.into_values().collect()
}
