pub mod docx;
pub mod odf;
pub mod pdf;
pub mod pptx;
pub mod txt;
pub mod xlsx;

use std::io::Read;

use crate::error::AliasError;
use crate::formats::{extension_of, FormatKind};
use crate::types::ParsedDocument;

pub fn parse_file(path: &str) -> Result<ParsedDocument, AliasError> {
    let ext = extension_of(path);
    let kind = FormatKind::from_ext(&ext).ok_or_else(|| AliasError::UnsupportedFormat(ext.clone()))?;

    let content = match kind {
        FormatKind::Text => txt::read(path)?,
        FormatKind::Docx => docx::read(path)?,
        FormatKind::Xlsx | FormatKind::Xls => xlsx::read(path)?,
        FormatKind::Pptx => pptx::read(path)?,
        FormatKind::Odf => odf::read(path)?,
        FormatKind::Pdf => pdf::read(path)?,
    };

    Ok(ParsedDocument {
        content,
        source_path: path.to_string(),
        format: ext,
        writable: kind.is_writable(),
    })
}

/// Öffnet ein ZIP-basiertes Office-Dokument.
pub(crate) fn open_zip(path: &str) -> Result<zip::ZipArchive<std::io::Cursor<Vec<u8>>>, AliasError> {
    let bytes = std::fs::read(path).map_err(|e| AliasError::FileRead(format!("{}: {}", path, e)))?;
    zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| AliasError::FileRead(format!("{}: not a valid Office file ({})", path, e)))
}

pub(crate) fn zip_entry_string<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut s = String::new();
    entry.read_to_string(&mut s).ok()?;
    Some(s)
}

/// Einträge mit Präfix/Suffix, natürlich sortiert (slide2 vor slide10).
pub(crate) fn zip_names_sorted<R: Read + std::io::Seek>(
    archive: &zip::ZipArchive<R>,
    prefix: &str,
    suffix: &str,
) -> Vec<String> {
    let mut names: Vec<String> = archive
        .file_names()
        .filter(|n| n.starts_with(prefix) && n.ends_with(suffix) && !n[prefix.len()..].contains('/'))
        .map(String::from)
        .collect();
    names.sort_by_key(|n| {
        let digits: String = n[prefix.len()..].chars().filter(|c| c.is_ascii_digit()).collect();
        (digits.parse::<u32>().unwrap_or(0), n.clone())
    });
    names
}
