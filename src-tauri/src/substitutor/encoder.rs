use crate::store::alias_store::AliasStore;
use crate::types::SubstitutionResult;

pub fn encode(text: &str, store: &AliasStore) -> SubstitutionResult {
    let mut entries: Vec<_> = store
        .entries
        .values()
        .filter(|e| e.confirmed)
        .collect();

    // Längste Originale zuerst → verhindert Teilersetzungen
    entries.sort_by(|a, b| b.original.len().cmp(&a.original.len()));

    let mut result = text.to_string();
    let mut replacements_made = 0;

    for entry in entries {
        let escaped = regex::escape(&entry.original);
        // Wortgrenzen versuchen, aber auch ohne akzeptieren (Firmennamen können Sonderzeichen haben)
        let pattern = format!(r"(?i)(?:\b|(?<=\s)|(?<=^)){escaped}(?:\b|(?=\s)|(?=$))");
        if let Ok(re) = regex::Regex::new(&pattern) {
            let before = result.len();
            result = re.replace_all(&result, entry.alias.as_str()).to_string();
            if result.len() != before || result.contains(&entry.alias) {
                // Zähle wie oft ersetzt wurde
                let count = count_occurrences(&result, &entry.alias);
                if count > 0 {
                    replacements_made += count;
                }
            }
        } else {
            // Fallback: einfaches String-Replace
            let new = result.replace(&entry.original, &entry.alias);
            if new != result {
                replacements_made += count_occurrences(&new, &entry.alias);
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
