//! Liest .docx-Dateien als ZIP-Archive und extrahiert Text direkt aus word/document.xml.
//! Kein docx-rs nötig — direktes XML-Parsing, robuster und schlanker.

use std::io::Read;

use crate::error::AliasError;
use crate::types::ParsedDocument;

pub fn read(path: &str) -> Result<ParsedDocument, AliasError> {
    let bytes = std::fs::read(path)
        .map_err(|e| AliasError::FileRead(format!("{}: {}", path, e)))?;

    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AliasError::DocxParse(format!("ZIP error: {}", e)))?;

    let xml = read_entry(&mut archive, "word/document.xml")?;
    let mut output = extract_text(&xml);

    // Alle Header/Footer-Dateien im ZIP enumieren und anhängen
    let mut hf_names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if (name.starts_with("word/header") || name.starts_with("word/footer"))
                && name.ends_with(".xml")
            {
                hf_names.push(name);
            }
        }
    }

    for name in hf_names {
        if let Ok(hf_xml) = read_entry(&mut archive, &name) {
            let hf = extract_text(&hf_xml);
            let hf = hf.trim().to_string();
            if !hf.is_empty() {
                output.push('\n');
                output.push_str(&hf);
            }
        }
    }

    Ok(ParsedDocument {
        content: output.trim().to_string(),
        source_path: path.to_string(),
        format: "docx".to_string(),
    })
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String, AliasError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| AliasError::DocxParse(format!("'{}' not found: {}", name, e)))?;
    let mut xml = String::new();
    entry
        .read_to_string(&mut xml)
        .map_err(|e| AliasError::DocxParse(format!("Read error '{}': {}", name, e)))?;
    Ok(xml)
}

/// Extrahiert lesbaren Text aus Word-XML.
/// Strategie: Jeden <w:p>-Block als Zeile behandeln,
/// <w:t>-Inhalte zusammenfügen, <w:tab> als Tab, <w:br> als Newline.
/// Tabellen (<w:tr>): Zellen tab-separiert, Zeilen newline-separiert.
fn extract_text(xml: &str) -> String {
    let mut output = String::new();
    // Paragraphen-Puffer für die aktuelle Zeile / Tabellenzelle
    let mut para = String::new();
    // Für Tabellen: Zellen der aktuellen Zeile
    let mut cells: Vec<String> = Vec::new();
    // Zustandsflags
    let mut in_body = false;
    let mut in_table_cell = false;
    let mut in_run = false;
    let mut in_text = false;
    let mut preserve = false;

    let mut i = 0;
    let chars: Vec<char> = xml.chars().collect();
    let n = chars.len();

    while i < n {
        if chars[i] == '<' {
            // Tag lesen
            i += 1;
            let closing = i < n && chars[i] == '/';
            if closing { i += 1; }
            let self_closing;

            // Tag-Inhalt bis '>'
            let tag_start = i;
            while i < n && chars[i] != '>' { i += 1; }
            let tag_raw: String = chars[tag_start..i].iter().collect();
            self_closing = tag_raw.ends_with('/');
            if i < n { i += 1; } // '>' überspringen

            let tag_name = tag_raw
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches('/')
                .to_string();

            // xml:space="preserve" prüfen
            if tag_name == "w:t" && !closing {
                preserve = tag_raw.contains("xml:space=\"preserve\"");
            }

            if !closing && !self_closing {
                // Öffnendes Tag
                match tag_name.as_str() {
                    "w:body" | "w:ftr" | "w:hdr" => in_body = true,
                    "w:tc" if in_body => in_table_cell = true,
                    "w:r" if in_body => in_run = true,
                    "w:t" if in_body && in_run => in_text = true,
                    _ => {}
                }
            } else if closing {
                // Schließendes Tag
                match tag_name.as_str() {
                    "w:body" | "w:ftr" | "w:hdr" => in_body = false,
                    "w:tr" if in_body => {
                        // Tabellenzeile abschließen
                        if !cells.is_empty() {
                            output.push_str(&cells.join("\t"));
                            output.push('\n');
                            cells.clear();
                        } else if !para.is_empty() {
                            output.push_str(&para);
                            output.push('\n');
                            para.clear();
                        }
                    }
                    "w:tc" if in_body => {
                        // Zelle abschließen
                        cells.push(para.trim_end_matches('\n').to_string());
                        para.clear();
                        in_table_cell = false;
                    }
                    "w:p" if in_body => {
                        if in_table_cell {
                            // Absatz innerhalb Tabellenzelle → Newline im Zellinhalt
                            if !para.is_empty() {
                                para.push('\n');
                            }
                        } else {
                            // Normaler Absatz → Zeile ausgeben
                            if para.is_empty() {
                                output.push('\n');
                            } else {
                                output.push_str(&para);
                                output.push('\n');
                                para.clear();
                            }
                        }
                        in_run = false;
                        in_text = false;
                    }
                    "w:r" if in_body => {
                        in_run = false;
                        in_text = false;
                    }
                    "w:t" if in_body => {
                        in_text = false;
                    }
                    _ => {}
                }
            } else {
                // Self-closing Tags
                if in_body && in_run {
                    match tag_name.as_str() {
                        "w:tab" => para.push('\t'),
                        "w:br" => para.push('\n'),
                        _ => {}
                    }
                }
            }
        } else if in_text {
            // Text-Inhalt lesen
            let text_start = i;
            while i < n && chars[i] != '<' { i += 1; }
            let raw: String = chars[text_start..i].iter().collect();
            let decoded = decode_entities(&raw);
            if preserve {
                para.push_str(&decoded);
            } else {
                para.push_str(decoded.trim());
            }
        } else {
            i += 1;
        }
    }

    // Aufräumen: mehrfache Leerzeilen reduzieren
    clean_output(output)
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
     .replace("&lt;", "<")
     .replace("&gt;", ">")
     .replace("&quot;", "\"")
     .replace("&apos;", "'")
     .replace("&#xD;", "")
     .replace("&#xA;", "\n")
}

fn clean_output(s: String) -> String {
    // Maximal 2 aufeinanderfolgende Leerzeilen
    let mut result = String::with_capacity(s.len());
    let mut blank_count = 0usize;
    for line in s.split('\n') {
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count <= 2 {
                result.push('\n');
            }
        } else {
            blank_count = 0;
            result.push_str(line);
            result.push('\n');
        }
    }
    result
}
