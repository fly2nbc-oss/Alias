//! PDF: nur Lesen des Textlayers (kein OCR für gescannte Seiten).

use crate::error::AliasError;

pub fn read(path: &str) -> Result<String, AliasError> {
    let doc = lopdf::Document::load(path).map_err(|e| AliasError::PdfParse(format!("{}: {}", path, e)))?;
    if doc.is_encrypted() {
        return Err(AliasError::PdfParse("PDF is password-protected".into()));
    }
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    let mut out = String::new();
    for p in pages {
        match doc.extract_text(&[p]) {
            Ok(t) => {
                out.push_str(&format!("=== Page {} ===\n", p));
                out.push_str(t.trim_end());
                out.push_str("\n\n");
            }
            Err(e) => out.push_str(&format!("=== Page {} === (text not readable: {})\n\n", p, e)),
        }
    }
    if out.lines().all(|l| l.trim().is_empty() || l.starts_with("=== Page")) {
        return Err(AliasError::PdfParse(
            "PDF contains no text layer (scanned document?)".into(),
        ));
    }
    Ok(out)
}
