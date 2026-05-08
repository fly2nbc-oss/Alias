//! Kalibrierung und Review-Flags nach den Detektoren.

use crate::types::{Category, DetectionSource, EntityCandidate};

/// Auto-Ersetzung / hohe Sicherheit (PRD-orientiert).
pub const THRESHOLD_HIGH_CONFIDENCE: f32 = 0.9;
/// Darunter: mittlere Unsicherheit → Review empfohlen (wenn nicht strukturell sicher).
pub const THRESHOLD_REVIEW: f32 = 0.85;

pub fn apply_pipeline_scores(mut candidates: Vec<EntityCandidate>) -> Vec<EntityCandidate> {
    for c in &mut candidates {
        // Strukturell sehr sichere Kategorien: kein Review-Zwang bei guter Basis
        let structural_safe = matches!(
            c.category,
            Category::Email | Category::Iban | Category::Telefon
        );

        if structural_safe && c.confidence >= 0.75 {
            c.needs_review = false;
            continue;
        }

        // NER-Personen: etwas höhere Vertrauensgrenze als reine Regex-Heuristik
        if c.detection_source == DetectionSource::Ner && c.category == Category::Person {
            if c.confidence >= 0.88 {
                c.needs_review = false;
                continue;
            }
            if c.confidence < 0.72 {
                c.needs_review = true;
                c.features
                    .entry("review_reason".into())
                    .or_insert("ner_low_confidence".into());
                continue;
            }
        }

        if c.confidence >= THRESHOLD_HIGH_CONFIDENCE {
            c.needs_review = false;
            continue;
        }

        if c.category == Category::Person && c.confidence < THRESHOLD_REVIEW {
            c.needs_review = true;
            c.features
                .entry("review_reason".into())
                .or_insert("person_mid_confidence".into());
            continue;
        }

        if c.confidence < THRESHOLD_REVIEW {
            c.needs_review = true;
            c.features
                .entry("review_reason".into())
                .or_insert("below_threshold".into());
        }
    }
    candidates
}
