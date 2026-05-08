use thiserror::Error;

#[derive(Error, Debug)]
pub enum AliasError {
    #[error("Could not read file: {0}")]
    FileRead(String),

    #[error("Unsupported file format: {0}")]
    UnsupportedFormat(String),

    #[error("DOCX parse error: {0}")]
    DocxParse(String),

    #[error("XLSX parse error: {0}")]
    XlsxParse(String),

    #[error("Entry not found: {0}")]
    EntryNotFound(String),

    #[error("Alias already in use: {0}")]
    AliasDuplicate(String),

    #[error("Persistence error: {0}")]
    Persistence(String),

    #[error("Invalid category: {0}")]
    InvalidCategory(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<AliasError> for String {
    fn from(e: AliasError) -> String {
        e.to_string()
    }
}
