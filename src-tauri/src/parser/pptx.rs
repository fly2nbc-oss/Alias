//! PowerPoint (.pptx): Folientext und Notizen.

use super::{open_zip, zip_entry_string, zip_names_sorted};
use crate::error::AliasError;
use crate::office_xml::{extract_text, PPTX};

pub fn read(path: &str) -> Result<String, AliasError> {
    let mut archive = open_zip(path)?;
    let mut out = String::new();

    let slides = zip_names_sorted(&archive, "ppt/slides/slide", ".xml");
    for (idx, name) in slides.iter().enumerate() {
        out.push_str(&format!("=== Slide {} ===\n", idx + 1));
        if let Some(xml) = zip_entry_string(&mut archive, name) {
            out.push_str(&extract_text(&xml, &PPTX));
        }
        let notes = name.replace("ppt/slides/slide", "ppt/notesSlides/notesSlide");
        if let Some(xml) = zip_entry_string(&mut archive, &notes) {
            let text = extract_text(&xml, &PPTX);
            if !text.trim().is_empty() {
                out.push_str("--- Notes ---\n");
                out.push_str(&text);
            }
        }
        out.push('\n');
    }
    Ok(out)
}
