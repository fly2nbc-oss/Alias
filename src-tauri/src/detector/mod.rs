pub mod abbreviation;
pub mod address;
pub mod location;
pub mod company;
pub mod date;
pub mod deduplicator;
pub mod email;
pub mod gazetteer;
pub mod iban;
pub mod money;
pub mod patterns;
pub mod person;
pub mod person_identity;
pub mod person_ner;
pub mod person_pipeline;
pub mod phone;
pub mod preprocessor;
pub mod product;
pub mod resolver;
pub mod scorer;
pub mod spans;

#[cfg(test)]
mod eval;

use crate::types::{Category, EntityCandidate};

/// PRD-Reihenfolge: E-Mail → IBAN → Betrag → Datum → Telefon → Adresse → Firma → NER(ORG/LOC/MISC) → Person → Produkt → Abkürzungen.
/// Bereits erkannte Zeichenbereiche werden für nachfolgende Kategorien gesperrt.
/// NER wird einmalig aufgerufen; Personen-NER fließt in person_pipeline, alle anderen Kategorien davor.
pub fn detect_all(text: &str) -> Vec<EntityCandidate> {
    let text = preprocessor::prepare_for_detection(text);
    let mut blocked: Vec<(usize, usize)> = Vec::new();
    let mut all: Vec<EntityCandidate> = Vec::new();

    all.extend(spans::apply_pass(&mut blocked, email::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, iban::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, money::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, date::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, phone::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, address::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, location::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, company::detect(text)));

    // NER einmalig ausführen — alle Entitätstypen
    let ner_all = person_ner::detect_all_entities_ner(text);
    let (ner_persons, ner_others): (Vec<_>, Vec<_>) =
        ner_all.into_iter().partition(|c| c.category == Category::Person);

    // ORG / LOC / MISC aus NER direkt eintragen (company-Duplikate werden später via deduplicator bereinigt)
    let ner_others_filtered: Vec<_> = ner_others
        .into_iter()
        .filter_map(|c| spans::filter_by_blocked_spans(c, &blocked))
        .collect();
    all.extend(spans::apply_pass(&mut blocked, ner_others_filtered));

    // Personen: NER-Ergebnisse + regelbasierte Schicht
    let blocked_for_person = blocked.clone();
    all.extend(spans::apply_pass(
        &mut blocked,
        person_pipeline::detect_with_ner(text, &blocked_for_person, ner_persons),
    ));

    all.extend(spans::apply_pass(&mut blocked, product::detect(text)));
    all.extend(spans::apply_pass(&mut blocked, abbreviation::detect(text)));

    let mut out = deduplicator::deduplicate(all);
    out = resolver::resolve_span_conflicts(out);
    scorer::apply_pipeline_scores(out)
}

#[cfg(test)]
mod tests {
    use super::detect_all;
    use crate::detector::person;
    use crate::types::Category;

    #[test]
    fn detects_person_with_title_signal() {
        let text = "Besprechung mit Dr. Schmidt und Frau Müller.";
        let candidates = person::detect(text);
        let dr = candidates.iter().find(|c| c.text == "Schmidt");
        let fr = candidates.iter().find(|c| c.text == "Müller");
        assert!(dr.is_some(), "expected Schmidt, got {:?}", candidates);
        assert!(fr.is_some(), "expected Müller, got {:?}", candidates);
        assert_eq!(dr.unwrap().category, Category::Person);
    }

    #[test]
    fn detects_person_via_gazetteer_first_name() {
        let text = "Anna Weber hat zugesagt.";
        let candidates = person::detect(text);
        let p = candidates.iter().find(|c| c.text == "Anna Weber");
        assert!(p.is_some(), "expected Anna Weber, got {:?}", candidates);
        assert_eq!(p.unwrap().category, Category::Person);
    }

    #[test]
    fn no_person_for_two_common_words_without_gazetteer_or_title() {
        let text = "Neue Technologie wurde freigegeben.";
        let candidates = person::detect(text);
        assert!(
            candidates.is_empty(),
            "expected no person, got {:?}",
            candidates
        );
    }

    #[test]
    fn detects_firma_via_signal_word() {
        let text = "Vertrag mit Partner Acme besprochen.";
        let candidates = detect_all(text);
        let acme = candidates.iter().find(|c| c.text == "Acme");
        assert!(acme.is_some(), "expected Acme, got {:?}", candidates);
        assert_eq!(acme.unwrap().category, Category::Firma);
    }

    #[test]
    fn detects_tuv_rheinl() {
        let text = "Text mit TÜV-Rheinl. Zertifikat";
        let candidates = detect_all(text);
        let tuv = candidates.iter().find(|c| c.text == "TÜV-Rheinl.");
        assert!(tuv.is_some(), "expected TÜV-Rheinl., got {:?}", candidates);
        assert_eq!(tuv.unwrap().category, Category::Firma);
    }

    #[test]
    fn detects_kmd_consulting() {
        let text = "Auftrag mit KMD Consulting besprochen.";
        let candidates = detect_all(text);
        let kmd = candidates.iter().find(|c| c.text == "KMD Consulting");
        assert!(kmd.is_some(), "expected KMD Consulting, got {:?}", candidates);
        assert_eq!(kmd.unwrap().category, Category::Firma);
    }

    #[test]
    fn detects_email_and_iban() {
        let text = "Kontakt: mail@beispiel.de IBAN DE89370400440532013000";
        let candidates = detect_all(text);
        assert!(
            candidates.iter().any(|c| c.text == "mail@beispiel.de" && c.category == Category::Email)
        );
        assert!(candidates.iter().any(|c| c.category == Category::Iban));
    }

    #[test]
    fn person_layer_c_trims_calendar_suffixes_to_one_entry() {
        let text = "Martin Gieswein Onboarding Day und Martin Gieswein Direct.";
        let c = detect_all(text);
        let persons: Vec<_> = c.iter().filter(|x| x.category == Category::Person).collect();
        assert_eq!(persons.len(), 1, "expected one person, got {:?}", persons);
        assert_eq!(persons[0].text, "Martin Gieswein");
        assert!(
            persons[0].occurrences >= 2,
            "expected merged occurrences, got {}",
            persons[0].occurrences
        );
    }

    #[test]
    fn person_merges_herr_and_plain_same_identity() {
        let text = "Herr Martin Gieswein traf Martin Gieswein wieder.";
        let c = detect_all(text);
        let persons: Vec<_> = c.iter().filter(|x| x.category == Category::Person).collect();
        assert_eq!(persons.len(), 1, "expected one person, got {:?}", persons);
        assert_eq!(persons[0].text, "Martin Gieswein");
    }

    #[test]
    fn person_does_not_merge_different_people() {
        let text = "Martin Gieswein und Anna Weber treffen sich.";
        let c = detect_all(text);
        let n = c.iter().filter(|x| x.category == Category::Person).count();
        assert_eq!(n, 2, "expected two distinct persons, got {:?}", c);
    }

    #[test]
    fn person_layer_c_dietmar_unterstuetzung_keeps_first_name_only() {
        let text = "Bitte wenden Sie sich an Dietmar Unterstützung.";
        let c = person::detect(text);
        let p = c.iter().find(|x| x.category == Category::Person && x.text.contains("Dietmar"));
        assert!(p.is_some(), "expected Dietmar, got {:?}", c);
        assert_eq!(p.unwrap().text, "Dietmar");
    }

    #[test]
    fn person_layer_c_christian_adolph_director_trims_role() {
        let text = "Christian Adolph Director wird benachrichtigt.";
        let c = person::detect(text);
        let p = c.iter().find(|x| x.category == Category::Person && x.text.contains("Christian"));
        assert!(p.is_some(), "expected Christian…, got {:?}", c);
        assert_eq!(p.unwrap().text, "Christian Adolph");
        assert!(!p.unwrap().text.contains("Director"));
    }

    #[test]
    fn person_layer_c_thomas_project_lead_trims_suffix_chain() {
        let text = "Kontakt: Thomas Project Lead.";
        let c = person::detect(text);
        let p = c.iter().find(|x| x.category == Category::Person && x.text.contains("Thomas"));
        assert!(p.is_some(), "expected Thomas…, got {:?}", c);
        assert_eq!(p.unwrap().text, "Thomas");
    }

    /// Regression: Telefon-Lookback darf nicht mitten in UTF-8-Zeichen slicen (sonst Panic → App-Crash).
    #[test]
    fn detect_no_panic_phone_context_with_utf8_lookback() {
        // 25× „ü“ = 50 Byte, dann 98× „x“ + Leerzeichen → Telefon beginnt bei Byte 149 → Lookback 49 liegt in der Mitte des 25. „ü“
        let mut s = String::new();
        s.push_str(&"ü".repeat(25));
        s.push_str(&"x".repeat(98));
        s.push_str(" 0170123456789");
        detect_all(&s);
    }
}
