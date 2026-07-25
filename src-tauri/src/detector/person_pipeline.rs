//! Personen: NER zuerst (Primärsignal), danach regelbasierte Schicht auf verbleibenden Spans.

use crate::detector::person;
use crate::detector::spans;
use crate::types::EntityCandidate;

/// Kombiniert vorberechnete NER-Personen mit klassischen `person::detect`-Treffern (ein ONNX-Lauf).
pub fn detect_with_ner(
    text: &str,
    blocked: &[(usize, usize)],
    ner_persons: Vec<EntityCandidate>,
) -> Vec<EntityCandidate> {
    let mut ner: Vec<EntityCandidate> = ner_persons
        .into_iter()
        .filter_map(|c| spans::filter_by_blocked_spans(c, blocked))
        .collect();

    let mut extended = blocked.to_vec();
    for c in &ner {
        for o in &c.offsets {
            extended.push((o[0], o[1]));
        }
    }

    let mut rules = person::detect(text);
    rules = rules
        .into_iter()
        .filter_map(|c| spans::filter_by_blocked_spans(c, &extended))
        .collect();

    ner.extend(rules);
    ner
}
