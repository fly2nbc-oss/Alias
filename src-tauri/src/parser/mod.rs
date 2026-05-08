pub mod docx;
pub mod txt;
pub mod xlsx;

use crate::error::AliasError;
use crate::types::ParsedDocument;
use std::path::Path;

pub fn parse_file(path: &str) -> Result<ParsedDocument, AliasError> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" => txt::read(path),
        "docx" => docx::read(path),
        "xlsx" | "xls" | "xlsm" => xlsx::read(path),
        other => Err(AliasError::UnsupportedFormat(other.to_string())),
    }
}
