use std::collections::{HashMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::types::{Category, DetectionSource, EntityCandidate};

static PLZ_PREFIXES: Lazy<HashSet<String>> = Lazy::new(|| {
    include_str!("../../data/plz_prefixes.txt")
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|s| s.to_string())
        .collect()
});

static STREET_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|str\.|weg|gasse|platz|allee|ring|damm|ufer|steig|pfad|chaussee|promenade|brücke|berg|tal|feld|hof|markt|graben)\s*\d+\s?[a-zA-Z]?\b",
    )
    .unwrap()
});

static STREET_PREFIX_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b(?:Am|An\sder|An\sdem|Auf\sder|Auf\sdem|Im|In\sder|In\sdem|Zum|Zur|Bei\sder|Bei\sdem)\s+[A-ZÄÖÜ][a-zäöüß]+\s*\d+\s?[a-zA-Z]?\b",
    )
    .unwrap()
});

static PLZ_ORT_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß]+(?:-[a-zäöüß]+)?)\b").unwrap()
});

fn line_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut v = Vec::new();
    let mut o = 0usize;
    for line in text.split('\n') {
        let end = o + line.len();
        v.push((o, end));
        o = end.saturating_add(1);
    }
    v
}

fn valid_plz(plz: &str) -> bool {
    if plz.len() != 5 || !plz.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    if plz.starts_with("00") {
        return false;
    }
    PLZ_PREFIXES.contains(&plz[..2])
}

/// PRD Schicht C: Straße Zeile i + PLZ/Ort Zeile i+1 → ein Adressblock.
pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let lines = line_ranges(text);
    let mut street_by_line: Vec<Vec<[usize; 2]>> = vec![vec![]; lines.len()];
    let mut plz_by_line: Vec<Vec<[usize; 2]>> = vec![vec![]; lines.len()];

    for (i, &(ls, le)) in lines.iter().enumerate() {
        let slice = &text[ls..le];
        for m in STREET_REGEX.find_iter(slice) {
            street_by_line[i].push([ls + m.start(), ls + m.end()]);
        }
        for m in STREET_PREFIX_REGEX.find_iter(slice) {
            street_by_line[i].push([ls + m.start(), ls + m.end()]);
        }
        for cap in PLZ_ORT_REGEX.captures_iter(slice) {
            let plz = cap.get(1).unwrap().as_str();
            if !valid_plz(plz) {
                continue;
            }
            let full = cap.get(0).unwrap();
            plz_by_line[i].push([full.start() + ls, full.end() + ls]);
        }
    }

    let mut merged_blocks: Vec<[usize; 2]> = Vec::new();
    for i in 0..lines.len().saturating_sub(1) {
        if street_by_line[i].is_empty() || plz_by_line[i + 1].is_empty() {
            continue;
        }
        for s in &street_by_line[i] {
            for p in &plz_by_line[i + 1] {
                merged_blocks.push([s[0], p[1]]);
            }
        }
    }

    fn span_in_any(span: [usize; 2], blocks: &[[usize; 2]]) -> bool {
        blocks
            .iter()
            .any(|b| span[0] >= b[0] && span[1] <= b[1])
    }

    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for b in &merged_blocks {
        let slice = &text[b[0]..b[1]];
        let key = format!("ADRESSE:{}", slice);
        let entry = results.entry(key).or_insert_with(|| {
            let mut e = EntityCandidate::rule_base(slice.to_string(), Category::Ort, 0.88, 0, vec![]);
            e.detection_source = DetectionSource::Parser;
            e
        });
        entry.occurrences += 1;
        entry.offsets.push(*b);
    }

    for (_i, spans) in street_by_line.into_iter().enumerate() {
        for span in spans {
            if span_in_any(span, &merged_blocks) {
                continue;
            }
            let slice = &text[span[0]..span[1]];
            let key = format!("STRASSE:{}", slice);
            let entry = results.entry(key).or_insert(EntityCandidate::rule_base(
                slice.to_string(),
                Category::Ort,
                0.82,
                0,
                vec![],
            ));
            entry.occurrences += 1;
            entry.offsets.push(span);
        }
    }

    for (_i, spans) in plz_by_line.into_iter().enumerate() {
        for span in spans {
            if span_in_any(span, &merged_blocks) {
                continue;
            }
            let slice = &text[span[0]..span[1]];
            let key = format!("PLZ:{}", slice);
            let entry = results.entry(key).or_insert(EntityCandidate::rule_base(
                slice.to_string(),
                Category::Ort,
                0.85,
                0,
                vec![],
            ));
            entry.occurrences += 1;
            entry.offsets.push(span);
        }
    }

    results.into_values().collect()
}
