//! Erstellt eine Kopie der Originaldatei mit angewandten Alias-Ersetzungen.
//! - Textdateien: Ersetzung im Text, Kodierung (UTF-8/BOM/UTF-16/Windows-1252) bleibt erhalten.
//! - Office (docx/xlsx/pptx/odt/ods/odp): Ersetzung nur in Textknoten, absatzweise
//!   (auch über Run-Grenzen hinweg); alle übrigen ZIP-Einträge werden unverändert kopiert.
//! - PDF und .xls: nur lesbar — kein Zurückschreiben im Originalformat.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::formats::{extension_of, FormatKind};
use crate::office_xml::{self, TextSpec};
use crate::store::alias_store::AliasStore;
use crate::substitutor::spans;

#[derive(serde::Serialize, Debug)]
pub struct SaveResult {
    pub path: String,
    pub replacements: usize,
}

/// Ausgabepfad: gleicher Ordner, `<stem>_anonym.<ext>` bzw. `<stem>_original.<ext>`.
/// Ein vorhandenes Gegen-Suffix wird entfernt (`bericht_anonym.docx` → `bericht_original.docx`).
pub fn output_path(source: &Path, mode: &str) -> PathBuf {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("txt");
    let (suffix, opposite) = if mode == "encode" {
        ("_anonym", "_original")
    } else {
        ("_original", "_anonym")
    };
    let base = stem
        .strip_suffix(opposite)
        .or_else(|| stem.strip_suffix(suffix))
        .filter(|b| !b.is_empty())
        .unwrap_or(stem);
    source.with_file_name(format!("{base}{suffix}.{ext}"))
}

/// Erstellt eine kodierte/dekodierte Kopie der Quelldatei.
pub fn save_copy(source_path: &str, mode: &str, store: &AliasStore) -> Result<SaveResult, String> {
    let src = Path::new(source_path);
    let ext = extension_of(source_path);
    let kind = FormatKind::from_ext(&ext).ok_or_else(|| format!("Format '.{ext}' is not supported"))?;
    if !kind.is_writable() {
        return Err(format!(
            "'.{ext}' can only be opened, not written back. Save the result as text instead."
        ));
    }
    let dst = output_path(src, mode);
    if dst == src {
        return Err("Output path equals source path".into());
    }

    let pairs = spans::pairs(store, mode);
    let raw = std::fs::read(src).map_err(|e| e.to_string())?;
    let (out, replacements) = match kind {
        FormatKind::Text => replace_in_text(&raw, &pairs),
        _ => replace_in_zip(&raw, &pairs, kind)?,
    };
    std::fs::write(&dst, out).map_err(|e| format!("{}: {}", dst.display(), e))?;

    Ok(SaveResult {
        path: dst.to_string_lossy().into_owned(),
        replacements,
    })
}

fn replace_in_text(raw: &[u8], pairs: &[(String, String)]) -> (Vec<u8>, usize) {
    let (text, enc) = crate::text_codec::decode(raw);
    let matches = spans::find_matches(&text, pairs);
    let n = matches.len();
    (crate::text_codec::encode(&spans::apply(&text, &matches), enc), n)
}

/// Welcher ZIP-Eintrag enthält Text, und wie ist er aufgebaut?
fn spec_for(kind: FormatKind, name: &str) -> Option<&'static TextSpec> {
    if name == "docProps/core.xml" || (kind == FormatKind::Odf && name == "meta.xml") {
        return Some(&office_xml::METADATA);
    }
    if !name.ends_with(".xml") {
        return None;
    }
    // SmartArt und Diagrammbeschriftungen nutzen DrawingML (<a:t>) in allen OOXML-Formaten
    if name.contains("/diagrams/") || name.contains("/charts/") {
        return Some(&office_xml::PPTX);
    }
    match kind {
        FormatKind::Docx => {
            let word_part = name == "word/document.xml"
                || name == "word/footnotes.xml"
                || name == "word/endnotes.xml"
                || name == "word/comments.xml"
                || ((name.starts_with("word/header") || name.starts_with("word/footer"))
                    && !name[5..].contains('/'));
            word_part.then_some(&office_xml::DOCX)
        }
        FormatKind::Xlsx => {
            if name == "xl/sharedStrings.xml" {
                Some(&office_xml::XLSX)
            } else if name.starts_with("xl/worksheets/sheet") {
                Some(&office_xml::XLSX_SHEET)
            } else if name.starts_with("xl/comments") {
                Some(&office_xml::XLSX_COMMENTS)
            } else {
                None
            }
        }
        FormatKind::Pptx => ["ppt/slides/", "ppt/notesSlides/", "ppt/slideMasters/", "ppt/slideLayouts/", "ppt/notesMasters/"]
            .iter()
            .any(|p| name.starts_with(p) && !name[p.len()..].contains('/'))
            .then_some(&office_xml::PPTX),
        FormatKind::Odf => matches!(name, "content.xml" | "styles.xml").then_some(&office_xml::ODF),
        _ => None,
    }
}

fn replace_in_zip(
    bytes: &[u8],
    pairs: &[(String, String)],
    kind: FormatKind,
) -> Result<(Vec<u8>, usize), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Not a valid Office file: {e}"))?;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let find = |text: &str| spans::find_matches(text, pairs);
    let mut total = 0usize;

    for i in 0..archive.len() {
        let name = archive.by_index_raw(i).map_err(|e| e.to_string())?.name().to_string();
        match spec_for(kind, &name) {
            Some(spec) => {
                let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                let mut xml = String::new();
                entry.read_to_string(&mut xml).map_err(|e| format!("{name}: {e}"))?;
                // In Arbeitsblättern steht in `<v>` meist eine Zahl oder ein Shared-String-Index.
                // Nur Werte mit Buchstaben (zwischengespeicherte Formel-Texte) anfassen, sonst
                // würde ein numerischer Eintrag (z. B. Betrag „1234“) die Datei beschädigen.
                let find_sheet = |text: &str| {
                    if text.chars().any(char::is_alphabetic) {
                        find(text)
                    } else {
                        Vec::new()
                    }
                };
                let finder: &dyn Fn(&str) -> Vec<office_xml::Match> =
                    if std::ptr::eq(spec, &office_xml::XLSX_SHEET) { &find_sheet } else { &find };
                let (replaced, n) = office_xml::replace_text(&xml, spec, finder);
                total += n;
                let mut options = zip::write::SimpleFileOptions::default()
                    .compression_method(entry.compression());
                if let Some(t) = entry.last_modified() {
                    options = options.last_modified_time(t);
                }
                writer.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
                writer.write_all(replaced.as_bytes()).map_err(|e| e.to_string())?;
            }
            None => {
                // Unverändert und ohne Neukomprimierung übernehmen
                let entry = archive.by_index_raw(i).map_err(|e| e.to_string())?;
                writer.raw_copy_file(entry).map_err(|e| e.to_string())?;
            }
        }
    }

    let finished = writer.finish().map_err(|e| e.to_string())?;
    Ok((finished.into_inner(), total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AliasEntry, Category};

    fn store() -> AliasStore {
        let mut s = AliasStore::new();
        for (id, o, a) in [("1", "Max Mustermann", "Person_1"), ("2", "Müller & Söhne", "Firma_1")] {
            s.entries.insert(
                id.to_string(),
                AliasEntry {
                    id: id.into(),
                    original: o.into(),
                    alias: a.into(),
                    category: Category::Person,
                    confirmed: true,
                },
            );
        }
        s
    }

    fn build_zip(files: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, content) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(content.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn read_zip(bytes: &[u8], name: &str) -> String {
        let mut a = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut s = String::new();
        a.by_name(name).unwrap().read_to_string(&mut s).unwrap();
        s
    }

    #[test]
    fn docx_roundtrip_all_parts() {
        let body = r#"<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Max </w:t></w:r><w:r><w:t>Mustermann</w:t></w:r></w:p></w:body></w:document>"#;
        let header = r#"<w:hdr><w:p><w:r><w:t>Müller &amp; Söhne</w:t></w:r></w:p></w:hdr>"#;
        let core = r#"<cp:coreProperties><dc:creator>Max Mustermann</dc:creator></cp:coreProperties>"#;
        let src = build_zip(&[
            ("word/document.xml", body),
            ("word/header2.xml", header),
            ("docProps/core.xml", core),
            ("word/media/image1.png", "Max Mustermann"),
        ]);
        let s = store();

        let enc_pairs = spans::pairs(&s, "encode");
        let (enc, n) = replace_in_zip(&src, &enc_pairs, FormatKind::Docx).unwrap();
        assert_eq!(n, 3);
        assert!(read_zip(&enc, "word/document.xml").contains("Person_1"));
        assert!(!read_zip(&enc, "word/document.xml").contains("Mustermann"));
        assert!(read_zip(&enc, "word/header2.xml").contains("Firma_1"));
        assert!(read_zip(&enc, "docProps/core.xml").contains("Person_1"));
        // Binärteile bleiben unberührt
        assert_eq!(read_zip(&enc, "word/media/image1.png"), "Max Mustermann");

        let dec_pairs = spans::pairs(&s, "decode");
        let (dec, _) = replace_in_zip(&enc, &dec_pairs, FormatKind::Docx).unwrap();
        assert_eq!(read_zip(&dec, "word/header2.xml"), header);
        assert_eq!(read_zip(&dec, "docProps/core.xml"), core);
        assert_eq!(
            office_xml::extract_text(&read_zip(&dec, "word/document.xml"), &office_xml::DOCX),
            "Max Mustermann\n"
        );
    }

    #[test]
    fn pptx_master_and_slides() {
        let slide = r#"<p:sld><a:p><a:r><a:t>Kontakt: Max Mustermann</a:t></a:r></a:p></p:sld>"#;
        let master = r#"<p:sldMaster><a:p><a:r><a:t>© Müller &amp; Söhne</a:t></a:r></a:p></p:sldMaster>"#;
        let src = build_zip(&[("ppt/slides/slide1.xml", slide), ("ppt/slideMasters/slideMaster1.xml", master)]);
        let s = store();
        let (enc, n) = replace_in_zip(&src, &spans::pairs(&s, "encode"), FormatKind::Pptx).unwrap();
        assert_eq!(n, 2);
        let (dec, _) = replace_in_zip(&enc, &spans::pairs(&s, "decode"), FormatKind::Pptx).unwrap();
        assert_eq!(read_zip(&dec, "ppt/slides/slide1.xml"), slide);
        assert_eq!(read_zip(&dec, "ppt/slideMasters/slideMaster1.xml"), master);
    }

    #[test]
    fn text_roundtrip_keeps_encoding() {
        let s = store();
        let original = crate::text_codec::encode(
            // Weitere Umlaute halten die Kodierung erkennbar; eine reine ASCII-Datei ist nicht
            // von UTF-8 unterscheidbar und wird dann als UTF-8 zurückgeschrieben.
            "Sehr geehrter Max Mustermann,\r\nGrüße, Ihre Müller & Söhne\r\n",
            crate::text_codec::TextEncoding::Windows1252,
        );
        let (enc, n) = replace_in_text(&original, &spans::pairs(&s, "encode"));
        assert_eq!(n, 2);
        let (dec, _) = replace_in_text(&enc, &spans::pairs(&s, "decode"));
        assert_eq!(dec, original);
    }

    #[test]
    fn xlsx_numeric_entry_does_not_touch_values() {
        let mut s = store();
        s.entries.insert(
            "3".into(),
            AliasEntry { id: "3".into(), original: "1234".into(), alias: "Betrag_1".into(), category: Category::Betrag, confirmed: true },
        );
        let sheet = r#"<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1234</v></c><c r="C1" t="str"><f>A1&amp;" x"</f><v>Max Mustermann x</v></c></row></sheetData></worksheet>"#;
        let shared = r#"<sst><si><t>Rechnung 1234</t></si></sst>"#;
        let src = build_zip(&[("xl/worksheets/sheet1.xml", sheet), ("xl/sharedStrings.xml", shared)]);
        let (enc, _) = replace_in_zip(&src, &spans::pairs(&s, "encode"), FormatKind::Xlsx).unwrap();
        let out = read_zip(&enc, "xl/worksheets/sheet1.xml");
        assert!(out.contains(r#"<c r="B1"><v>1234</v></c>"#));
        assert!(out.contains("<v>Person_1 x</v>"));
        assert!(out.contains(r#"<f>A1&amp;" x"</f>"#));
        assert!(read_zip(&enc, "xl/sharedStrings.xml").contains("Rechnung Betrag_1"));
    }

    #[test]
    fn output_names() {
        let p = Path::new("C:/x/bericht.docx");
        assert_eq!(output_path(p, "encode"), Path::new("C:/x/bericht_anonym.docx"));
        let a = Path::new("C:/x/bericht_anonym.docx");
        assert_eq!(output_path(a, "decode"), Path::new("C:/x/bericht_original.docx"));
    }
}
