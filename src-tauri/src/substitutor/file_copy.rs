//! Erstellt eine Kopie der Originaldatei mit angewandten Alias-Ersetzungen.
//! Unterstützt: .txt, .md (direkt), .docx, .xlsx (ZIP-XML-Ersetzung).

use std::io::{Read, Write};
use std::path::Path;

use crate::store::alias_store::AliasStore;
use crate::substitutor::encoder;

/// Gibt den Ausgabepfad zurück: gleicher Ordner, `<stem>_anonym.<ext>` bzw. `<stem>_original.<ext>`.
pub fn output_path(source: &Path, mode: &str) -> std::path::PathBuf {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("txt");
    let suffix = if mode == "encode" { "_anonym" } else { "_original" };
    source.with_file_name(format!("{stem}{suffix}.{ext}"))
}

/// Erstellt eine kodierte/dekodierte Kopie der Quelldatei.
/// Gibt den Pfad der erstellten Datei zurück.
pub fn save_copy(source_path: &str, mode: &str, store: &AliasStore) -> Result<String, String> {
    let src = Path::new(source_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let dst = output_path(src, mode);

    match ext.as_str() {
        "txt" | "md" => save_text_copy(src, &dst, mode, store),
        "docx" => save_zip_copy(src, &dst, mode, store, is_docx_content),
        "xlsx" | "xlsm" | "xls" => save_zip_copy(src, &dst, mode, store, is_xlsx_content),
        _ => Err(format!("Format '.{ext}' is not supported")),
    }?;

    Ok(dst.to_string_lossy().into_owned())
}

fn save_text_copy(
    src: &Path,
    dst: &Path,
    mode: &str,
    store: &AliasStore,
) -> Result<(), String> {
    let content = std::fs::read_to_string(src).map_err(|e| e.to_string())?;
    let result = if mode == "encode" {
        encoder::encode(&content, store).text
    } else {
        crate::substitutor::decoder::decode(&content, store).text
    };
    std::fs::write(dst, result).map_err(|e| e.to_string())?;
    Ok(())
}

fn save_zip_copy(
    src: &Path,
    dst: &Path,
    mode: &str,
    store: &AliasStore,
    should_modify: fn(&str) -> bool,
) -> Result<(), String> {
    let raw = std::fs::read(src).map_err(|e| e.to_string())?;
    let out = replace_in_zip(&raw, mode, store, should_modify)?;
    std::fs::write(dst, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn replace_in_zip(
    bytes: &[u8],
    mode: &str,
    store: &AliasStore,
    should_modify: fn(&str) -> bool,
) -> Result<Vec<u8>, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    let out_buf = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(out_buf);

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(entry.compression());

        writer.start_file(&name, options).map_err(|e| e.to_string())?;

        if should_modify(&name) {
            let mut xml = String::new();
            entry.read_to_string(&mut xml).map_err(|e| e.to_string())?;
            let replaced = if mode == "encode" {
                encoder::encode(&xml, store).text
            } else {
                crate::substitutor::decoder::decode(&xml, store).text
            };
            writer.write_all(replaced.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            writer.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }

    let finished = writer.finish().map_err(|e| e.to_string())?;
    Ok(finished.into_inner())
}

fn is_docx_content(name: &str) -> bool {
    matches!(name, "word/document.xml" | "word/header1.xml" | "word/footer1.xml")
}

fn is_xlsx_content(name: &str) -> bool {
    name == "xl/sharedStrings.xml" || name.starts_with("xl/worksheets/")
}
