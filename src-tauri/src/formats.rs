//! Zentrale Liste der unterstützten Dateiformate.
//! Parser, Kopie-Erstellung, Dateidialog und Drag & Drop beziehen sich alle hierauf.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormatKind {
    /// Reine Textdateien (txt, md, csv, json, xml, …) — Kodierung bleibt erhalten.
    Text,
    /// Word (Office Open XML)
    Docx,
    /// Excel (Office Open XML)
    Xlsx,
    /// PowerPoint (Office Open XML)
    Pptx,
    /// OpenDocument (LibreOffice: odt, ods, odp)
    Odf,
    /// Altes Excel-Binärformat — nur lesen
    Xls,
    /// PDF — nur lesen (Textlayer)
    Pdf,
}

pub const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "log", "json", "xml", "html", "htm", "yaml", "yml",
    "toml", "ini", "cfg", "conf", "properties", "sql", "eml",
];

const OTHER_EXTENSIONS: &[&str] = &[
    "docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp", "xls", "pdf",
];

impl FormatKind {
    pub fn from_ext(ext: &str) -> Option<Self> {
        let ext = ext.to_lowercase();
        if TEXT_EXTENSIONS.contains(&ext.as_str()) {
            return Some(FormatKind::Text);
        }
        Some(match ext.as_str() {
            "docx" | "docm" => FormatKind::Docx,
            "xlsx" | "xlsm" => FormatKind::Xlsx,
            "pptx" | "pptm" => FormatKind::Pptx,
            "odt" | "ods" | "odp" => FormatKind::Odf,
            "xls" => FormatKind::Xls,
            "pdf" => FormatKind::Pdf,
            _ => return None,
        })
    }

    /// Kann Alias eine kodierte/dekodierte Kopie im Originalformat schreiben?
    pub fn is_writable(self) -> bool {
        !matches!(self, FormatKind::Xls | FormatKind::Pdf)
    }
}

pub fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// Alle öffnenbaren Endungen (ohne Punkt, klein geschrieben).
pub fn all_extensions() -> Vec<&'static str> {
    TEXT_EXTENSIONS.iter().chain(OTHER_EXTENSIONS).copied().collect()
}
