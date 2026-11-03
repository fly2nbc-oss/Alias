use crate::error::AliasError;

pub fn read(path: &str) -> Result<String, AliasError> {
    let bytes = std::fs::read(path).map_err(|e| AliasError::FileRead(format!("{}: {}", path, e)))?;
    Ok(crate::text_codec::decode(&bytes).0)
}
