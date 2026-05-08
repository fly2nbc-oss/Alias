//! Kleiner Referenzkorpus-Test und Hilfsfunktionen für Kategorie-Metriken (Evaluations-Grundlage).

use crate::types::Category;

#[cfg(test)]
mod tests {
    use crate::detector::detect_all;
    use crate::types::Category;

    fn assert_has(text: &str, needle: &str, cat: Category) {
        let c = detect_all(text);
        assert!(
            c.iter().any(|x| x.text == needle && x.category == cat),
            "expected {:?} {:?}, got {:?}",
            cat,
            needle,
            c.iter()
                .map(|x| (&x.text, &x.category))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn gold_email_iban() {
        assert_has(
            "Kontakt mail@x.de und IBAN DE89370400440532013000",
            "mail@x.de",
            Category::Email,
        );
        let c = detect_all("Kontakt mail@x.de und IBAN DE89370400440532013000");
        assert!(c.iter().any(|x| x.category == Category::Iban));
    }

    #[test]
    fn gold_geburtsdatum_feature() {
        // Kein DD.MM.YYYY im Satz: Telefon-Detektor läuft vor Datum und kann „12.03…“ als Nummer fassen.
        let c = detect_all("Kunde geboren am 15. März 1980 in Berlin");
        let d = c
            .iter()
            .find(|x| x.text.contains("März") && x.category == Category::Datum)
            .expect("geburtsdatum");
        assert_eq!(
            d.features.get("date_kind").map(String::as_str),
            Some("geburtsdatum")
        );
    }

    #[test]
    fn gold_person_title() {
        assert_has("Treffen mit Dr. Weber", "Weber", Category::Person);
    }

    #[test]
    fn gold_no_false_person_common_words() {
        let c = detect_all("Neue Technologie wurde freigegeben.");
        assert!(!c.iter().any(|x| x.category == Category::Person));
    }

    #[test]
    fn metrics_perfect_match() {
        let (p, r, f) = super::precision_recall_f1(
            &[(Category::Email, "a@b.de")],
            &[(Category::Email, "a@b.de")],
        );
        assert!((p - 1.0).abs() < f32::EPSILON);
        assert!((r - 1.0).abs() < f32::EPSILON);
        assert!((f - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn ner_without_model_is_empty_but_pipeline_ok() {
        use crate::detector::person_ner;
        let ner_persons: Vec<_> = person_ner::detect_all_entities_ner("Anna Meyer und Bob")
            .into_iter()
            .filter(|c| c.category == Category::Person)
            .collect();
        assert!(ner_persons.is_empty());
        assert_has("Besuch bei Anna Meyer", "Anna Meyer", Category::Person);
    }

    #[test]
    fn preprocessor_ner_byte_offsets_contract() {
        assert!(crate::detector::preprocessor::ner_uses_byte_offsets_in_source_text());
    }
}

/// Precision / Recall / F1 für exakte (Kategorie, Text)-Paare (einfaches IoU=1-Matching).
pub fn precision_recall_f1(
    predicted: &[(Category, &str)],
    gold: &[(Category, &str)],
) -> (f32, f32, f32) {
    let mut tp = 0usize;
    for g in gold {
        if predicted.iter().any(|p| p.0 == g.0 && p.1 == g.1) {
            tp += 1;
        }
    }
    let fp = predicted.len().saturating_sub(tp);
    let fn_ = gold.len().saturating_sub(tp);
    let p = if tp + fp > 0 {
        tp as f32 / (tp + fp) as f32
    } else {
        1.0
    };
    let r = if tp + fn_ > 0 {
        tp as f32 / (tp + fn_) as f32
    } else {
        1.0
    };
    let f1 = if p + r > 0.0 {
        2.0 * p * r / (p + r)
    } else {
        0.0
    };
    (p, r, f1)
}
