use crate::types::EntityCandidate;

/// Entfernt alle Offsets, die mit gesperrten Spans überlappen; passt `occurrences` an.
pub fn filter_by_blocked_spans(
    mut c: EntityCandidate,
    blocked: &[(usize, usize)],
) -> Option<EntityCandidate> {
    c.offsets.retain(|o| {
        !blocked
            .iter()
            .any(|&(b0, b1)| o[0] < b1 && o[1] > b0)
    });
    if c.offsets.is_empty() {
        return None;
    }
    c.occurrences = c.offsets.len();
    Some(c)
}

/// Filtert eine Kandidatenliste und registriert alle verbleibenden Spans als gesperrt.
pub fn apply_pass(
    blocked: &mut Vec<(usize, usize)>,
    candidates: Vec<EntityCandidate>,
) -> Vec<EntityCandidate> {
    let mut accepted = Vec::new();
    for c in candidates {
        let Some(c) = filter_by_blocked_spans(c, blocked) else {
            continue;
        };
        for o in &c.offsets {
            blocked.push((o[0], o[1]));
        }
        accepted.push(c);
    }
    accepted
}
