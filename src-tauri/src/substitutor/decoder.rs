use crate::store::alias_store::AliasStore;
use crate::types::SubstitutionResult;

pub fn decode(text: &str, store: &AliasStore) -> SubstitutionResult {
    let mut entries: Vec<_> = store
        .entries
        .values()
        .filter(|e| e.confirmed)
        .collect();

    // Längste Aliase zuerst → verhindert Teilersetzungen
    entries.sort_by(|a, b| b.alias.len().cmp(&a.alias.len()));

    let mut result = text.to_string();
    let mut replacements_made = 0;

    for entry in entries {
        let escaped = regex::escape(&entry.alias);
        if let Ok(re) = regex::Regex::new(&escaped) {
            let before_count = count_occurrences(&result, &entry.alias);
            result = re.replace_all(&result, entry.original.as_str()).to_string();
            if before_count > 0 {
                replacements_made += before_count;
            }
        } else {
            let new = result.replace(&entry.alias, &entry.original);
            if new != result {
                replacements_made += count_occurrences(&result, &entry.alias);
                result = new;
            }
        }
    }

    SubstitutionResult {
        text: result,
        replacements_made,
    }
}

fn count_occurrences(text: &str, pattern: &str) -> usize {
    let mut count = 0;
    let mut start = 0;
    while let Some(pos) = text[start..].find(pattern) {
        count += 1;
        start += pos + pattern.len();
    }
    count
}
