use calamine::{open_workbook_auto, Data, Reader};

use crate::error::AliasError;
use crate::types::ParsedDocument;

pub fn read(path: &str) -> Result<ParsedDocument, AliasError> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AliasError::XlsxParse(format!("{}: {}", path, e)))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let mut output = String::new();

    for sheet_name in &sheet_names {
        output.push_str(&format!("=== Sheet: {} ===\n", sheet_name));
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            for row in range.rows() {
                let cells: Vec<String> = row.iter().map(cell_to_string).collect();
                // Skip empty rows
                if cells.iter().all(|c| c.is_empty()) {
                    continue;
                }
                output.push_str(&cells.join("\t"));
                output.push('\n');
            }
        }
        output.push('\n');
    }

    Ok(ParsedDocument {
        content: output,
        source_path: path.to_string(),
        format: "xlsx".to_string(),
    })
}

fn cell_to_string(c: &Data) -> String {
    match c {
        Data::String(s) => s.clone(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                format!("{}", f)
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => format!("{}", dt),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Empty => String::new(),
        Data::Error(e) => format!("#ERR:{:?}", e),
    }
}
