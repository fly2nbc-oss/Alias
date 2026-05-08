use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Email,
    Iban,
    Telefon,
    Datum,
    Person,
    Firma,
    Produkt,
    Ort,
    Betrag,
    Sonstiges,
}

impl Category {
    pub fn label(&self) -> &'static str {
        match self {
            Category::Email => "Email",
            Category::Iban => "IBAN",
            Category::Telefon => "Phone",
            Category::Datum => "Date",
            Category::Person => "Person",
            Category::Firma => "Company",
            Category::Produkt => "Product",
            Category::Ort => "Location",
            Category::Betrag => "Amount",
            Category::Sonstiges => "Other",
        }
    }

    /// Für Konfliktauflösung bei überlappenden Spans (höher = gewinnt).
    pub fn overlap_resolution_priority(&self) -> u8 {
        match self {
            Category::Email | Category::Iban => 9,
            Category::Telefon => 8,
            Category::Datum => 7,
            Category::Betrag => 6,
            Category::Firma => 5,
            Category::Person => 4,
            Category::Produkt | Category::Ort => 3,
            Category::Sonstiges => 2,
        }
    }
}

impl std::fmt::Display for Category {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AliasEntry {
    pub id: String,
    pub original: String,
    pub alias: String,
    pub category: Category,
    pub confirmed: bool,
}

/// Herkunftssignal der Erkennung (Hybrid-Pipeline).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DetectionSource {
    #[default]
    Rule,
    Lexicon,
    /// Platzhalter/ONNX-NER, wenn angebunden
    Ner,
    Hybrid,
    Parser,
}

impl DetectionSource {
    /// Höhere Zahl = höhere Priorität bei Zusammenführung mehrerer Signale.
    pub fn priority_rank(&self) -> u8 {
        match self {
            DetectionSource::Ner => 5,
            DetectionSource::Parser => 4,
            DetectionSource::Lexicon => 3,
            DetectionSource::Hybrid => 2,
            DetectionSource::Rule => 1,
        }
    }

    pub fn merge_prefer_stronger(a: Self, b: Self) -> Self {
        if a.priority_rank() >= b.priority_rank() {
            a
        } else {
            b
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EntityCandidate {
    pub text: String,
    pub category: Category,
    pub confidence: f32,
    pub occurrences: usize,
    pub offsets: Vec<[usize; 2]>,
    /// Woher stammt der Treffer (Regel, Lexikon, NER, …).
    #[serde(default)]
    pub detection_source: DetectionSource,
    /// Mittlere Unsicherheit: UI kann zur manuellen Prüfung markieren.
    #[serde(default)]
    pub needs_review: bool,
    /// Leichte Feature-Bags (z. B. Kontext-Hinweise) für Scoring/Debug.
    #[serde(default)]
    pub features: HashMap<String, String>,
}

impl EntityCandidate {
    pub fn new(
        text: String,
        category: Category,
        confidence: f32,
        occurrences: usize,
        offsets: Vec<[usize; 2]>,
        detection_source: DetectionSource,
        needs_review: bool,
    ) -> Self {
        Self {
            text,
            category,
            confidence,
            occurrences,
            offsets,
            detection_source,
            needs_review,
            features: HashMap::new(),
        }
    }

    /// Regelbasierte Kandidaten (Standard für alle Regex-/Listen-Detektoren).
    pub fn rule_base(
        text: String,
        category: Category,
        confidence: f32,
        occurrences: usize,
        offsets: Vec<[usize; 2]>,
    ) -> Self {
        Self {
            text,
            category,
            confidence,
            occurrences,
            offsets,
            detection_source: DetectionSource::Rule,
            needs_review: false,
            features: HashMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ParsedDocument {
    pub content: String,
    pub source_path: String,
    pub format: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SubstitutionResult {
    pub text: String,
    pub replacements_made: usize,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct StoreExport {
    pub version: u8,
    pub created_at: String,
    pub entries: Vec<AliasEntry>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkAddItem {
    pub original: String,
    pub category: Category,
    pub alias: Option<String>,
}
