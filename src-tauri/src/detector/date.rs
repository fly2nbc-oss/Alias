use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::types::{Category, EntityCandidate};

/// DD.MM.YYYY oder DD.MM.YY
static RE_DMY_DOT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b").unwrap()
});

/// DD. Monat YYYY — deutsch und englisch
static RE_DMY_MONTH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(\d{1,2})\.\s?(January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|Mai|Juni|Juli|Oktober|Dezember)\s*(\d{2,4})\b",
    )
    .unwrap()
});

/// Monat YYYY — standalone: "April 2025", "März 2025", "January 2026"
static RE_MONTH_YEAR: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})\b",
    )
    .unwrap()
});

/// ISO YYYY-MM-DD
static RE_ISO: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d{4})-(\d{2})-(\d{2})\b").unwrap());

/// DD/MM/YYYY
static RE_DMY_SLASH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b").unwrap()
});

fn expand_year(y: u32) -> Option<u32> {
    match y {
        0..=30 => Some(2000 + y),
        31..=99 => Some(1900 + y),
        1900..=2030 => Some(y),
        _ => None,
    }
}

fn is_leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn days_in_month(month: u32, year: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn valid_ymd(day: u32, month: u32, year: u32) -> bool {
    if !(1900..=2030).contains(&year) || !(1..=12).contains(&month) {
        return false;
    }
    let dim = days_in_month(month, year);
    day >= 1 && day <= dim
}

fn month_name_de_to_num(name: &str) -> Option<u32> {
    let lower = name.to_lowercase();
    match lower.as_str() {
        "januar" | "january" => Some(1),
        "februar" | "february" => Some(2),
        "märz" | "maerz" | "march" => Some(3),
        "april" => Some(4),
        "mai" | "may" => Some(5),
        "juni" | "june" => Some(6),
        "juli" | "july" => Some(7),
        "august" => Some(8),
        "september" => Some(9),
        "oktober" | "october" => Some(10),
        "november" => Some(11),
        "dezember" | "december" => Some(12),
        _ => None,
    }
}

/// PRD: Schlüsselwörter in den letzten Wörtern vor dem Datum (max. ca. 5–8 Wörter).
fn is_birth_context(text: &str, date_start: usize) -> bool {
    let before = &text[..date_start];
    let words: Vec<&str> = before.split_whitespace().collect();
    let n = words.len().min(8);
    let tail = words[words.len().saturating_sub(n)..].join(" ");
    let lower = tail.to_lowercase();
    lower.contains("geboren am")
        || lower.contains("geboren ")
        || lower.contains("geb.")
        || lower.contains("geburtsdatum")
        || lower.contains("geburtstag")
        || lower.contains("date of birth")
        || lower.contains(" dob")
        || lower.ends_with(" dob")
        || lower.contains("dob ")
        || lower.starts_with("dob")
}

#[derive(Clone, Copy)]
struct RawSpan {
    start: usize,
    end: usize,
}

/// Überlappungen auflösen: längere Spans zuerst, bei Gleichstand Geburtsdatum bevorzugen.
fn merge_spans(mut spans: Vec<RawSpan>) -> Vec<RawSpan> {
    spans.sort_by(|a, b| {
        let la = a.end - a.start;
        let lb = b.end - b.start;
        lb.cmp(&la).then_with(|| a.start.cmp(&b.start))
    });
    let mut kept: Vec<RawSpan> = Vec::new();
    for s in spans {
        let overlap = kept.iter().any(|k| s.start < k.end && s.end > k.start);
        if !overlap {
            kept.push(s);
        }
    }
    kept.sort_by_key(|s| s.start);
    kept
}

pub fn detect(text: &str) -> Vec<EntityCandidate> {
    let mut raw: Vec<RawSpan> = Vec::new();

    for cap in RE_DMY_DOT.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let d: u32 = cap[1].parse().unwrap_or(0);
        let mo: u32 = cap[2].parse().unwrap_or(0);
        let y_raw: u32 = cap[3].parse().unwrap_or(0);
        let y = if cap[3].len() == 2 {
            expand_year(y_raw)
        } else {
            Some(y_raw)
        };
        let Some(y) = y else { continue };
        if !valid_ymd(d, mo, y) {
            continue;
        }
        raw.push(RawSpan {
            start: m.start(),
            end: m.end(),
        });
    }

    for cap in RE_DMY_MONTH.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let d: u32 = cap[1].parse().unwrap_or(0);
        let Some(mo) = month_name_de_to_num(&cap[2]) else {
            continue;
        };
        let y_raw: u32 = cap[3].parse().unwrap_or(0);
        let y = if cap[3].len() == 2 {
            expand_year(y_raw)
        } else {
            Some(y_raw)
        };
        let Some(y) = y else { continue };
        if !valid_ymd(d, mo, y) {
            continue;
        }
        raw.push(RawSpan {
            start: m.start(),
            end: m.end(),
        });
    }

    for cap in RE_MONTH_YEAR.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let y: u32 = cap[2].parse().unwrap_or(0);
        if !(1900..=2030).contains(&y) {
            continue;
        }
        raw.push(RawSpan { start: m.start(), end: m.end() });
    }

    for cap in RE_ISO.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let y: u32 = cap[1].parse().unwrap_or(0);
        let mo: u32 = cap[2].parse().unwrap_or(0);
        let d: u32 = cap[3].parse().unwrap_or(0);
        if !valid_ymd(d, mo, y) {
            continue;
        }
        raw.push(RawSpan {
            start: m.start(),
            end: m.end(),
        });
    }

    for cap in RE_DMY_SLASH.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let d: u32 = cap[1].parse().unwrap_or(0);
        let mo: u32 = cap[2].parse().unwrap_or(0);
        let y_raw: u32 = cap[3].parse().unwrap_or(0);
        let y = if cap[3].len() == 2 {
            expand_year(y_raw)
        } else {
            Some(y_raw)
        };
        let Some(y) = y else { continue };
        if !valid_ymd(d, mo, y) {
            continue;
        }
        raw.push(RawSpan {
            start: m.start(),
            end: m.end(),
        });
    }

    let merged = merge_spans(raw);

    let mut results: HashMap<String, EntityCandidate> = HashMap::new();

    for s in merged {
        let slice = &text[s.start..s.end];
        let birth = is_birth_context(text, s.start);
        let cat = if birth {
            Category::Datum
        } else {
            Category::Datum
        };
        let conf = if birth { 0.93 } else { 0.91 };
        let entry = results.entry(slice.to_string()).or_insert_with(|| {
            let mut e = EntityCandidate::rule_base(slice.to_string(), cat, conf, 0, vec![]);
            e.features.insert(
                "date_kind".into(),
                if birth {
                    "geburtsdatum".into()
                } else {
                    "datum".into()
                },
            );
            e
        });
        entry.occurrences += 1;
        entry.offsets.push([s.start, s.end]);
        if birth {
            entry.category = Category::Datum;
            entry.confidence = entry.confidence.max(0.93);
            entry.features.insert("date_kind".into(), "geburtsdatum".into());
        }
    }

    results.into_values().collect()
}
