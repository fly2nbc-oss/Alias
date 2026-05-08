use crate::detector::person_identity;
use crate::types::{Category, DetectionSource, EntityCandidate};

fn normalize_for_comparison(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Zusammenführen und Deduplizieren aller Kandidaten aus verschiedenen Passes.
/// Regel: Bei überlappenden Spans gewinnt das längste Match.
pub fn deduplicate(mut candidates: Vec<EntityCandidate>) -> Vec<EntityCandidate> {
    // Nach Textlänge absteigend sortieren (längste zuerst)
    candidates.sort_by(|a, b| b.text.len().cmp(&a.text.len()));

    // Zusammenführen von ähnlichen Texten
    let mut merged: Vec<EntityCandidate> = Vec::new();
    for candidate in candidates {
        let norm_cand = normalize_for_comparison(&candidate.text);
        
        let existing = merged.iter_mut().find(|e| {
            let norm_e = normalize_for_comparison(&e.text);
            
            // Identisch nach Normalisierung (z.B. "TÜV Rheinl" == "TÜV-Rheinl.")
            if norm_e == norm_cand {
                return true;
            }

            // Gleiche Person trotz unterschiedlicher Oberfläche (z. B. mit/ohne Anrede, Suffix getrimmt)
            if person_identity::same_person(e, &candidate) {
                return true;
            }
            
            // Substring-Check: Ist der kürzere Kandidat ein eigenständiges Wort im längeren?
            // z.B. "TÜV" in "TÜV Rheinl" oder "TÜV-Rheinl."
            if e.category == candidate.category && candidate.text.len() >= 3 {
                let e_lower = e.text.to_lowercase();
                let c_lower = candidate.text.to_lowercase();
                
                if let Some(byte_idx) = e_lower.find(&c_lower) {
                    // byte_idx auf char-Ebene abbilden, um sicher auf Vorgänger/Nachfolger zuzugreifen
                    let is_start_boundary = byte_idx == 0 || !e_lower[..byte_idx].chars().last().unwrap().is_alphanumeric();
                    let end_byte_idx = byte_idx + c_lower.len();
                    let is_end_boundary = end_byte_idx == e_lower.len() || !e_lower[end_byte_idx..].chars().next().unwrap().is_alphanumeric();
                    
                    if is_start_boundary && is_end_boundary {
                        return true;
                    }
                }
            }
            
            false
        });

        if let Some(existing) = existing {
            if existing.category == Category::Person && candidate.category == Category::Person {
                existing.text =
                    person_identity::choose_display_text(&existing.text, &candidate.text);
            }
            // Beste Konfidenz behalten
            if candidate.confidence > existing.confidence {
                existing.confidence = candidate.confidence;
            }
            existing.detection_source = DetectionSource::merge_prefer_stronger(
                existing.detection_source.clone(),
                candidate.detection_source.clone(),
            );
            existing.needs_review = existing.needs_review || candidate.needs_review;
            for (k, v) in candidate.features.iter() {
                existing.features.entry(k.clone()).or_insert_with(|| v.clone());
            }
            existing.occurrences += candidate.occurrences;
            existing.offsets.extend(candidate.offsets);
        } else {
            merged.push(candidate);
        }
    }

    // Überlappende Offsets entfernen: wenn ein Offset innerhalb eines längeren
    // bereits erfassten Spans liegt, wird der kürzere Kandidat entfernt.
    // Wir bauen eine Liste der "genutzten" Bereiche auf.
    let mut used_spans: Vec<[usize; 2]> = Vec::new();
    let mut result: Vec<EntityCandidate> = Vec::new();

    for mut candidate in merged {
        // Behalte nur Offsets, die nicht in bereits genutzten Spans liegen
        candidate.offsets.retain(|offset| {
            !used_spans
                .iter()
                .any(|used| offset[0] >= used[0] && offset[1] <= used[1])
        });

        if candidate.offsets.is_empty() {
            continue;
        }
        used_spans.extend(candidate.offsets.iter().cloned());
        result.push(candidate);
    }

    // Nach Häufigkeit absteigend sortieren für die UI
    result.sort_by(|a, b| b.occurrences.cmp(&a.occurrences));
    result
}
