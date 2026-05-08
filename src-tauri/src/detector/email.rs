use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::types::{Category, EntityCandidate};

pub static EMAIL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap()
});

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for m in EMAIL_REGEX.find_iter(text) {
        let matched_text = m.as_str().to_string();
        let entry = results.entry(matched_text.clone()).or_insert(EntityCandidate::rule_base(
            matched_text.clone(),
            Category::Email,
            0.98,
            0,
            vec![],
        ));
        entry.occurrences += 1;
        entry.offsets.push([m.start(), m.end()]);
    }

    results.into_values().collect()
}
