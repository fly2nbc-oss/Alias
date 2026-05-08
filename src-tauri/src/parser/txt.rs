use crate::error::AliasError;
use crate::types::ParsedDocument;

pub fn read(path: &str) -> Result<ParsedDocument, AliasError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AliasError::FileRead(format!("{}: {}", path, e)))?;
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt")
        .to_lowercase();
    Ok(ParsedDocument {
        content,
        source_path: path.to_string(),
        format: ext,
    })
}
