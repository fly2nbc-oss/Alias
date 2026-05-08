//! Globale Konfliktauflösung für überlappende Spans unterschiedlicher Kategorien.
//! Reihenfolge: Kategorie-Priorität → längere Span → höhere Confidence.

use std::collections::HashSet;

use crate::types::EntityCandidate;

#[derive(Clone)]
struct SpanPick {
    span: [usize; 2],
    cat_pri: u8,
    len: usize,
    conf: f32,
    cand_idx: usize,
    off_idx: usize,
}

/// Entfernt überlappende Offsets aus „schwächeren“ Kandidaten (greedy nach Priorität).
pub fn resolve_span_conflicts(mut candidates: Vec<EntityCandidate>) -> Vec<EntityCandidate> {
    if candidates.is_empty() {
        return candidates;
    }

    let mut picks: Vec<SpanPick> = Vec::new();
    for (ci, c) in candidates.iter().enumerate() {
        for (oi, off) in c.offsets.iter().enumerate() {
            picks.push(SpanPick {
                span: *off,
                cat_pri: c.category.overlap_resolution_priority(),
                len: off[1].saturating_sub(off[0]),
                conf: c.confidence,
                cand_idx: ci,
                off_idx: oi,
            });
        }
    }

    picks.sort_by(|a, b| {
        b.cat_pri
            .cmp(&a.cat_pri)
            .then_with(|| b.len.cmp(&a.len))
            .then_with(|| b.conf.partial_cmp(&a.conf).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut kept_spans: Vec<[usize; 2]> = Vec::new();
    let mut keep: HashSet<(usize, usize)> = HashSet::new();

    for p in picks {
        let overlap = kept_spans
            .iter()
            .any(|s| p.span[0] < s[1] && p.span[1] > s[0]);
        if overlap {
            continue;
        }
        kept_spans.push(p.span);
        keep.insert((p.cand_idx, p.off_idx));
    }

    for (ci, c) in candidates.iter_mut().enumerate() {
        let mut new_offsets: Vec<[usize; 2]> = Vec::new();
        for (oi, off) in c.offsets.iter().enumerate() {
            if keep.contains(&(ci, oi)) {
                new_offsets.push(*off);
            }
        }
        c.offsets = new_offsets;
        c.occurrences = c.offsets.len();
    }

    candidates.retain(|c| !c.offsets.is_empty());
    candidates
}
