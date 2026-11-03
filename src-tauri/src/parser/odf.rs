//! OpenDocument (.odt, .ods, .odp): Text aus content.xml.

use super::{open_zip, zip_entry_string};
use crate::error::AliasError;
use crate::office_xml::{extract_text, ODF};

pub fn read(path: &str) -> Result<String, AliasError> {
    let mut archive = open_zip(path)?;
    let xml = zip_entry_string(&mut archive, "content.xml")
        .ok_or_else(|| AliasError::FileRead(format!("{}: content.xml missing", path)))?;
    let mut out = extract_text(&xml, &ODF);
    // Kopf-/Fußzeilen stehen in styles.xml
    if let Some(styles) = zip_entry_string(&mut archive, "styles.xml") {
        let hf = extract_text(&styles, &ODF);
        if !hf.trim().is_empty() {
            out.push('\n');
            out.push_str(&hf);
        }
    }
    Ok(out)
}
