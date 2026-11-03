//! Textknoten-basierte Verarbeitung von Office-XML (docx, xlsx, pptx, odt, …).
//!
//! Office-Programme verteilen zusammenhängenden Text oft auf mehrere Runs
//! (`<w:r><w:t>Max </w:t></w:r><w:r><w:t>Mustermann</w:t></w:r>`). Deshalb wird pro Absatz
//! der Text aller Textknoten zusammengesetzt, darin gesucht und das Ergebnis wieder auf
//! die ursprünglichen Knoten verteilt. Markup, Attribute und Formatierung bleiben
//! unverändert; nur geänderte Textknoten werden neu geschrieben.

use std::ops::Range;

/// Beschreibt, wo in einem XML-Teil der sichtbare Text steht.
pub struct TextSpec {
    /// Elemente, die einen Absatz bilden (Suchbereich für Treffer).
    pub para_tags: &'static [&'static str],
    /// Elemente, deren Zeichendaten Text sind. `None` = alle Zeichendaten im Absatz.
    pub text_tags: Option<&'static [&'static str]>,
    /// Leere Elemente, die den Text im Absatz trennen (Tab, Zeilenumbruch).
    pub break_tags: &'static [&'static str],
    /// `xml:space="preserve"` ergänzen, wenn ein geänderter Knoten mit Leerraum beginnt/endet
    /// (nötig für WordprocessingML `<w:t>`).
    pub add_space_preserve: bool,
}

pub const DOCX: TextSpec = TextSpec {
    para_tags: &["w:p"],
    text_tags: Some(&["w:t", "w:delText"]),
    break_tags: &["w:tab", "w:br", "w:cr"],
    add_space_preserve: true,
};

pub const PPTX: TextSpec = TextSpec {
    para_tags: &["a:p"],
    text_tags: Some(&["a:t"]),
    break_tags: &["a:br"],
    add_space_preserve: false,
};

/// Excel: Shared Strings (`<si>`).
pub const XLSX: TextSpec = TextSpec {
    para_tags: &["si"],
    text_tags: Some(&["t"]),
    break_tags: &[],
    add_space_preserve: false,
};

/// Excel-Arbeitsblätter: Inline-Strings (`<is>`) und zwischengespeicherte Formelergebnisse
/// (`<v>` bei `t="str"`). Zahlen in `<v>` enthalten nie einen Suchbegriff mit Buchstaben.
pub const XLSX_SHEET: TextSpec = TextSpec {
    para_tags: &["is", "v"],
    text_tags: None,
    break_tags: &[],
    add_space_preserve: false,
};

/// Excel-Kommentare
pub const XLSX_COMMENTS: TextSpec = TextSpec {
    para_tags: &["text"],
    text_tags: Some(&["t"]),
    break_tags: &[],
    add_space_preserve: false,
};

pub const ODF: TextSpec = TextSpec {
    para_tags: &["text:p", "text:h"],
    text_tags: None,
    break_tags: &["text:tab", "text:line-break", "text:s"],
    add_space_preserve: false,
};

/// Dokumenteigenschaften (Autor, Titel, …) in `docProps/core.xml` bzw. ODF `meta.xml`.
pub const METADATA: TextSpec = TextSpec {
    para_tags: &[
        "dc:creator",
        "dc:title",
        "dc:subject",
        "dc:description",
        "cp:lastModifiedBy",
        "cp:keywords",
        "meta:initial-creator",
        "meta:keyword",
    ],
    text_tags: None,
    break_tags: &[],
    add_space_preserve: false,
};

/// Ein Treffer im zusammengesetzten Absatztext: Byte-Bereich und Ersatztext.
pub type Match = (usize, usize, String);

struct TextNode {
    /// Byte-Bereich der rohen Zeichendaten im XML
    range: Range<usize>,
    /// Dekodierter Text
    text: String,
    /// Position des `>` des öffnenden Text-Tags, falls `xml:space` fehlt und der Knoten
    /// direkt auf das Tag folgt.
    space_insert_at: Option<usize>,
}

/// Ein zusammenhängender Textbereich (Absatz bzw. Teilstück zwischen Tabs/Umbrüchen).
type Segment = Vec<TextNode>;

fn scan(xml: &str, spec: &TextSpec) -> Vec<Vec<Segment>> {
    let b = xml.as_bytes();
    let n = b.len();
    let mut done: Vec<Vec<Segment>> = Vec::new();
    let mut stack: Vec<Vec<Segment>> = Vec::new();
    let mut text_depth = 0usize;
    // `>`-Position des zuletzt geöffneten Text-Tags ohne xml:space (für direkt folgenden Text)
    let mut last_text_open: Option<(usize, bool)> = None;
    let mut i = 0usize;

    while i < n {
        if b[i] != b'<' {
            let start = i;
            while i < n && b[i] != b'<' {
                i += 1;
            }
            let in_text = spec.text_tags.is_none() || text_depth > 0;
            if in_text {
                if let Some(para) = stack.last_mut() {
                    let space_insert_at = match last_text_open {
                        Some((pos, false)) if pos + 1 == start => Some(pos),
                        _ => None,
                    };
                    para.last_mut().unwrap().push(TextNode {
                        range: start..i,
                        text: decode_entities(&xml[start..i]),
                        space_insert_at,
                    });
                }
            }
            continue;
        }

        // Kommentare, Processing Instructions, CDATA, Doctype überspringen
        let rest = &xml[i..];
        let skip_to = if rest.starts_with("<!--") {
            Some(("-->", 4))
        } else if rest.starts_with("<?") {
            Some(("?>", 2))
        } else if rest.starts_with("<![CDATA[") {
            Some(("]]>", 9))
        } else if rest.starts_with("<!") {
            Some((">", 2))
        } else {
            None
        };
        if let Some((end, skip)) = skip_to {
            i = match xml[i + skip..].find(end) {
                Some(p) => i + skip + p + end.len(),
                None => n,
            };
            continue;
        }

        // Tag bis `>` lesen (Anführungszeichen in Attributen beachten)
        let mut j = i + 1;
        let mut quote: Option<u8> = None;
        while j < n {
            let c = b[j];
            match quote {
                Some(q) if c == q => quote = None,
                Some(_) => {}
                None if c == b'"' || c == b'\'' => quote = Some(c),
                None if c == b'>' => break,
                None => {}
            }
            j += 1;
        }
        if j >= n {
            break;
        }
        let tag = &xml[i + 1..j];
        let closing = tag.starts_with('/');
        let self_closing = tag.ends_with('/');
        let name = tag
            .trim_start_matches('/')
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("");
        let is_para = spec.para_tags.contains(&name);
        let is_text = spec.text_tags.map_or(false, |t| t.contains(&name));

        if closing {
            if is_para {
                if let Some(mut para) = stack.pop() {
                    para.retain(|s| !s.is_empty());
                    if !para.is_empty() {
                        done.push(para);
                    }
                }
            } else if is_text {
                text_depth = text_depth.saturating_sub(1);
            }
        } else if self_closing {
            if spec.break_tags.contains(&name) {
                if let Some(para) = stack.last_mut() {
                    para.push(Vec::new());
                }
            }
        } else if is_para {
            stack.push(vec![Vec::new()]);
        } else if is_text {
            text_depth += 1;
            last_text_open = Some((j, tag.contains("xml:space")));
        }
        i = j + 1;
    }
    done
}

/// Liefert den sichtbaren Text: ein Absatz pro Zeile, Teilstücke tab-getrennt.
pub fn extract_text(xml: &str, spec: &TextSpec) -> String {
    let mut out = String::new();
    for para in scan(xml, spec) {
        let line: Vec<String> = para
            .iter()
            .map(|seg| seg.iter().map(|n| n.text.as_str()).collect::<String>())
            .collect();
        let line = line.join("\t");
        if !line.trim().is_empty() {
            out.push_str(line.trim_end());
            out.push('\n');
        }
    }
    out
}

/// Ersetzt Text absatzweise. `find` liefert sortierte, nicht überlappende Treffer
/// im zusammengesetzten Text. Rückgabe: neues XML und Anzahl der Ersetzungen.
pub fn replace_text(
    xml: &str,
    spec: &TextSpec,
    find: &dyn Fn(&str) -> Vec<Match>,
) -> (String, usize) {
    // (Bereich im XML, neuer Rohinhalt)
    let mut edits: Vec<(Range<usize>, String)> = Vec::new();
    let mut count = 0usize;

    for para in scan(xml, spec) {
        for seg in para {
            let joined: String = seg.iter().map(|n| n.text.as_str()).collect();
            let matches = find(&joined);
            if matches.is_empty() {
                continue;
            }
            count += matches.len();
            let new_texts = distribute(&seg, &joined, &matches);
            for (node, new_text) in seg.iter().zip(new_texts) {
                if new_text == node.text {
                    continue;
                }
                if spec.add_space_preserve {
                    let needs = new_text.starts_with(char::is_whitespace)
                        || new_text.ends_with(char::is_whitespace);
                    if let (true, Some(pos)) = (needs, node.space_insert_at) {
                        edits.push((pos..pos, " xml:space=\"preserve\"".to_string()));
                    }
                }
                edits.push((node.range.clone(), encode_entities(&new_text)));
            }
        }
    }

    if edits.is_empty() {
        return (xml.to_string(), count);
    }
    edits.sort_by_key(|(r, _)| (r.start, r.end));
    let mut out = String::with_capacity(xml.len() + 64);
    let mut cursor = 0;
    for (range, text) in edits {
        out.push_str(&xml[cursor..range.start]);
        out.push_str(&text);
        cursor = range.end;
    }
    out.push_str(&xml[cursor..]);
    (out, count)
}

/// Verteilt den ersetzten Text zurück auf die Knoten: Unveränderter Text bleibt in seinem
/// Knoten, ein Ersatztext landet im Knoten, in dem der Treffer beginnt.
fn distribute(nodes: &[TextNode], joined: &str, matches: &[Match]) -> Vec<String> {
    let mut bounds = Vec::with_capacity(nodes.len());
    let mut pos = 0;
    for node in nodes {
        bounds.push(pos..pos + node.text.len());
        pos += node.text.len();
    }
    let mut out = vec![String::new(); nodes.len()];

    let copy_range = |out: &mut Vec<String>, a: usize, b: usize| {
        for (k, r) in bounds.iter().enumerate() {
            let s = a.max(r.start);
            let e = b.min(r.end);
            if s < e {
                out[k].push_str(&joined[s..e]);
            }
        }
    };

    let mut cursor = 0;
    for (start, end, rep) in matches {
        copy_range(&mut out, cursor, *start);
        let k = bounds
            .iter()
            .position(|r| *start >= r.start && *start < r.end)
            .unwrap_or(nodes.len() - 1);
        out[k].push_str(rep);
        cursor = *end;
    }
    copy_range(&mut out, cursor, joined.len());
    out
}

pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let decoded = rest.find(';').filter(|&e| e <= 12).and_then(|e| {
            let ent = &rest[1..e];
            let ch = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                    u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32)
                }
                _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            ch.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn encode_entities(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_literal(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Vec<Match> {
        move |text: &str| {
            let mut m = Vec::new();
            for (from, to) in pairs {
                for (p, _) in text.match_indices(from) {
                    m.push((p, p + from.len(), to.to_string()));
                }
            }
            m.sort_by_key(|x| x.0);
            m
        }
    }

    #[test]
    fn replaces_across_runs() {
        let xml = r#"<w:p><w:r><w:t xml:space="preserve">Hallo Max </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Mustermann GmbH</w:t></w:r></w:p>"#;
        let f = find_literal(&[("Max Mustermann", "Person_1")]);
        let (out, n) = replace_text(xml, &DOCX, &f);
        assert_eq!(n, 1);
        assert_eq!(
            out,
            r#"<w:p><w:r><w:t xml:space="preserve">Hallo Person_1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> GmbH</w:t></w:r></w:p>"#
        );
        // und zurück
        let back = find_literal(&[("Person_1", "Max Mustermann")]);
        let (orig, _) = replace_text(&out, &DOCX, &back);
        assert_eq!(extract_text(&orig, &DOCX), "Hallo Max Mustermann GmbH\n");
    }

    #[test]
    fn handles_entities_and_ignores_markup() {
        let xml = r#"<w:p w:rsidR="Müller"><w:r><w:t>Müller &amp; Söhne</w:t></w:r></w:p>"#;
        let f = find_literal(&[("Müller & Söhne", "Firma_1"), ("Müller", "X")]);
        let (out, _) = replace_text(xml, &DOCX, &f);
        // Attribut unverändert; nur Text ersetzt (find_literal liefert hier 2 Treffer am selben
        // Start — der echte Finder in spans.rs verhindert Überlappungen)
        assert!(out.starts_with(r#"<w:p w:rsidR="Müller">"#));
    }

    #[test]
    fn odf_text_and_breaks() {
        let xml = r#"<text:p text:style-name="P1">Anna<text:tab/>Berlin <text:span>Schmidt</text:span></text:p>"#;
        assert_eq!(extract_text(xml, &ODF), "Anna\tBerlin Schmidt\n");
        let f = find_literal(&[("Berlin Schmidt", "Person_2 & Co")]);
        let (out, n) = replace_text(xml, &ODF, &f);
        assert_eq!(n, 1);
        assert_eq!(
            out,
            r#"<text:p text:style-name="P1">Anna<text:tab/>Person_2 &amp; Co<text:span></text:span></text:p>"#
        );
    }
}
