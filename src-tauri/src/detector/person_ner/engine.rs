//! ONNX Token-Classification (BIO) für alle Entity-Typen — offline, lazy geladen (`ort`).
//! Erkennt PER → Person, ORG → Firma, LOC → Ort, MISC → Sonstiges.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ndarray::{Array3, Axis};
use once_cell::sync::OnceCell;
use ort::session::Session;
use ort::value::Tensor;
use serde::Deserialize;
use tokenizers::Tokenizer;

use super::MODELS_DIR;
use crate::types::{Category, DetectionSource, EntityCandidate};

const MAX_SEQ_LEN: usize = 512;

static ENGINE: OnceCell<Mutex<Option<Arc<NerEngine>>>> = OnceCell::new();

/// BIO-Rolle mit zugeordneter Entitätskategorie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BioRole {
    Outside,
    /// B-* Label → Begin einer Entität der gegebenen Kategorie
    Begin(Category),
    /// I-* Label → Fortsetzung einer Entität der gegebenen Kategorie
    Inside(Category),
    /// Unbekannter/irrelevanter Entitätstyp
    Other,
}

#[derive(Deserialize)]
struct NerLabelsFile {
    labels: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    model_id: Option<String>,
}

pub struct NerEngine {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    labels: Vec<String>,
}

impl NerEngine {
    fn try_load() -> Option<Arc<Self>> {
        let dir = resolve_models_dir()?;
        let model_path = dir.join("model.onnx");
        let tokenizer_path = dir.join("tokenizer.json");
        let labels_path = dir.join("ner_labels.json");
        if !model_path.is_file() || !tokenizer_path.is_file() || !labels_path.is_file() {
            return None;
        }

        let labels_json = std::fs::read_to_string(&labels_path).ok()?;
        let parsed: NerLabelsFile = serde_json::from_str(&labels_json).ok()?;
        if parsed.labels.is_empty() {
            return None;
        }

        let mut tokenizer = Tokenizer::from_file(&tokenizer_path).ok()?;
        let mut trunc = tokenizers::TruncationParams::default();
        trunc.max_length = MAX_SEQ_LEN;
        trunc.strategy = tokenizers::TruncationStrategy::LongestFirst;
        trunc.stride = 0;
        let _ = tokenizer.with_truncation(Some(trunc));

        let session = Session::builder()
            .ok()?
            .commit_from_file(model_path)
            .map_err(|e| { eprintln!("[ner] Session load error: {e}"); e })
            .ok()?;

        eprintln!("[ner] Model loaded. Labels: {}", parsed.labels.len());

        Some(Arc::new(NerEngine {
            session: Mutex::new(session),
            tokenizer,
            labels: parsed.labels,
        }))
    }

    fn infer(&self, text: &str) -> Vec<EntityCandidate> {
        if text.trim().is_empty() {
            return vec![];
        }

        let enc = match self.tokenizer.encode(text, true) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[ner] Tokenizer encode: {e}");
                return vec![];
            }
        };

        let ids = enc.get_ids();
        let mask = enc.get_attention_mask();
        let tokens = enc.get_tokens();
        let offsets = enc.get_offsets();
        let seq_len = ids.len();
        if seq_len == 0 || seq_len > MAX_SEQ_LEN {
            return vec![];
        }

        let ids_i64: Vec<i64> = ids.iter().map(|&x| x as i64).collect();
        let mask_i64: Vec<i64> = mask.iter().map(|&x| x as i64).collect();
        let zeros = vec![0i64; seq_len];

        let input_ids_t = Tensor::from_array(([1usize, seq_len], ids_i64)).expect("input_ids tensor");
        let attention_mask_t =
            Tensor::from_array(([1usize, seq_len], mask_i64)).expect("attention_mask");
        let token_type_ids_t = Tensor::from_array(([1usize, seq_len], zeros)).expect("token_type_ids");

        let (batch, seq, num_labels, flat) = {
            let mut session = self.session.lock().expect("ner session lock");
            let outputs = match session.run(ort::inputs![
                "input_ids" => input_ids_t,
                "attention_mask" => attention_mask_t,
                "token_type_ids" => token_type_ids_t,
            ]) {
                Ok(o) => o,
                Err(e) => {
                    eprintln!("[ner] Inference: {e}");
                    return vec![];
                }
            };
            // "logits" versuchen, sonst ersten verfügbaren Tensor nehmen
            let v = if outputs.get("logits").is_some() {
                &outputs["logits"]
            } else {
                eprintln!("[ner] 'logits' not found, using first tensor.");
                &outputs[0]
            };
            let (shape, data) = match v.try_extract_tensor::<f32>() {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[ner] Extract logits: {e}");
                    return vec![];
                }
            };
            let rank = shape.len();
            if rank != 3 {
                eprintln!("[ner] Unexpected logits rank: {rank}");
                return vec![];
            }
            let batch = shape[0] as usize;
            let seq = shape[1] as usize;
            let num_labels = shape[2] as usize;
            if batch != 1 || seq != seq_len {
                eprintln!("[ner] Logits batch/seq mismatch");
                return vec![];
            }
            (batch, seq, num_labels, data.to_vec())
        };

        let arr = Array3::from_shape_vec((batch, seq, num_labels), flat).expect("logits array");
        let arr = arr.index_axis(Axis(0), 0);

        let mut per_token: Vec<(BioRole, f32, (usize, usize))> = Vec::with_capacity(seq_len);
        for i in 0..seq_len {
            let tok = tokens.get(i).map(String::as_str).unwrap_or("");
            if tok == "[CLS]" || tok == "[SEP]" || tok == "<pad>" || tok == "<s>" || tok == "</s>" {
                continue;
            }
            let row = arr.index_axis(Axis(0), i);
            let logits_slice: Vec<f32> = row.iter().copied().collect();
            let (label_idx, conf) = argmax_softmax(&logits_slice);
            let label = self
                .labels
                .get(label_idx)
                .map(String::as_str)
                .unwrap_or("O");
            let role = label_role(label);
            let off = offsets.get(i).copied().unwrap_or((0, 0));
            // Jeden Token aufnehmen der eine Entität beginnt/fortsetzt oder gültige Offsets hat
            let is_entity = matches!(role, BioRole::Begin(_) | BioRole::Inside(_));
            if off.0 < off.1 || is_entity {
                per_token.push((role, conf, off));
            }
        }

        spans_from_bio(&per_token, text)
    }
}

fn argmax_softmax(logits: &[f32]) -> (usize, f32) {
    if logits.is_empty() {
        return (0, 0.0);
    }
    let m = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut exps: Vec<f32> = logits.iter().map(|x| (x - m).exp()).collect();
    let sum: f32 = exps.iter().sum();
    if sum > 0.0 {
        for e in &mut exps {
            *e /= sum;
        }
    }
    let mut best_i = 0usize;
    let mut best_v = exps[0];
    for (i, &v) in exps.iter().enumerate() {
        if v > best_v {
            best_v = v;
            best_i = i;
        }
    }
    (best_i, best_v)
}

/// Mappt ein BIO-Label auf `BioRole` mit Kategorie-Payload.
/// Unterstützt: PER→Person, ORG→Firma, LOC→Ort, MISC→Sonstiges.
fn label_role(label: &str) -> BioRole {
    let label = label.trim();
    if label.eq_ignore_ascii_case("o") || label.eq_ignore_ascii_case("outside") {
        return BioRole::Outside;
    }
    let mut it = label.splitn(2, '-');
    let pos = it.next().unwrap_or("").to_uppercase();
    let typ = it.next().unwrap_or("").to_uppercase();

    let cat = match typ.as_str() {
        s if s.contains("PER") || s == "PERSON" => Category::Person,
        "ORG" | "ORGANIZATION" | "ORGANISATION" => Category::Firma,
        "LOC" | "LOCATION" | "GPE" | "FAC" => Category::Ort,
        "MISC" | "PRODUCT" | "WORK_OF_ART" | "EVENT" => Category::Sonstiges,
        "DATE" | "TIME" => Category::Datum,
        _ => {
            return if matches!(pos.as_str(), "B" | "I") {
                BioRole::Other
            } else {
                BioRole::Outside
            };
        }
    };

    match pos.as_str() {
        "B" => BioRole::Begin(cat),
        "I" => BioRole::Inside(cat),
        _ => BioRole::Outside,
    }
}

/// Konvertiert BIO-Tokenfolge zu Kandidaten mit Kategorie.
/// Offsets sind Byte-Indizes im Originaltext.
pub(crate) fn spans_from_bio(
    per_token: &[(BioRole, f32, (usize, usize))],
    text: &str,
) -> Vec<EntityCandidate> {
    let mut out: Vec<EntityCandidate> = Vec::new();
    // (start, end, confidences, category)
    let mut cur: Option<(usize, usize, Vec<f32>, Category)> = None;

    let flush = |out: &mut Vec<EntityCandidate>,
                 cur: Option<(usize, usize, Vec<f32>, Category)>| {
        if let Some((s, e, confs, cat)) = cur {
            if s < e && e <= text.len() {
                push_span(out, text, s, e, &confs, cat);
            }
        }
    };

    for (role, conf, off) in per_token {
        match role {
            BioRole::Outside | BioRole::Other => {
                flush(&mut out, cur.take());
            }
            BioRole::Begin(cat) => {
                flush(&mut out, cur.take());
                if off.0 < off.1 && off.1 <= text.len() {
                    cur = Some((off.0, off.1, vec![*conf], cat.clone()));
                }
            }
            BioRole::Inside(cat) => {
                match cur.as_mut() {
                    Some((ref mut s, ref mut e, ref mut confs, ref cur_cat)) if cur_cat == cat => {
                        if off.0 < off.1 && off.1 <= text.len() {
                            *e = (*e).max(off.1);
                            *s = (*s).min(off.0);
                            confs.push(*conf);
                        }
                    }
                    _ => {
                        // Kategorie-Wechsel oder kein aktiver Span: flush + neu beginnen
                        flush(&mut out, cur.take());
                        if off.0 < off.1 && off.1 <= text.len() {
                            cur = Some((off.0, off.1, vec![*conf], cat.clone()));
                        }
                    }
                }
            }
        }
    }
    flush(&mut out, cur);
    out
}

fn push_span(
    out: &mut Vec<EntityCandidate>,
    text: &str,
    start: usize,
    end: usize,
    confs: &[f32],
    category: Category,
) {
    let slice = text.get(start..end).unwrap_or("");
    if slice.trim().is_empty() {
        return;
    }
    let mean_conf = if confs.is_empty() {
        0.85
    } else {
        confs.iter().sum::<f32>() / confs.len() as f32
    };
    let mut c = EntityCandidate::new(
        slice.to_string(),
        category.clone(),
        mean_conf.clamp(0.0, 1.0),
        1,
        vec![[start, end]],
        DetectionSource::Ner,
        false,
    );
    c.features.insert("ner".into(), "onnx".into());
    c.features.insert("model".into(), "local_token_classification".into());
    c.features.insert("ner_cat".into(), category.label().to_string());
    out.push(c);
}

fn resolve_models_dir() -> Option<PathBuf> {
    if let Ok(g) = MODELS_DIR.lock() {
        if let Some(ref p) = *g {
            if p.is_dir() {
                return Some(p.clone());
            }
        }
    }
    std::env::var("ALIAS_NER_MODEL_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

/// Alle Entitäten (PER, ORG, LOC, MISC) via ONNX erkennen.
pub fn detect_with_optional_model(text: &str) -> Vec<EntityCandidate> {
    get_or_load_engine().map_or_else(Vec::new, |e| e.infer(text))
}

/// Lädt die Engine (lazy) und führt eine Testinferenz durch.
/// Gibt `(engine_loaded, info_zeilen)` zurück — für den NER-Status-Badge.
pub fn diagnose_ner() -> (bool, Vec<String>) {
    let Some(engine) = get_or_load_engine() else {
        return (false, vec!["Could not load engine".into()]);
    };

    let info = vec![
        format!("Engine: loaded"),
        format!("Labels: {}", engine.labels.len()),
    ];
    (true, info)
}

fn get_or_load_engine() -> Option<Arc<NerEngine>> {
    let mut slot = ENGINE.get_or_init(|| Mutex::new(None)).lock().expect("ner lock");
    if slot.is_none() {
        *slot = NerEngine::try_load();
        if slot.is_none() {
            eprintln!("[ner] Could not load ONNX engine.");
        }
    }
    slot.clone()
}

/// Engine vorab laden (ohne Inferenz) — für Pre-Warming beim App-Start.
/// Blockierend; muss in einem eigenen Thread aufgerufen werden.
pub fn prewarm() {
    let loaded = get_or_load_engine().is_some();
    eprintln!("[ner] Pre-warm complete (loaded={})", loaded);
}

/// Drop cached session so the next inference reloads from disk (e.g. after model download).
pub fn reset_engine_cache() {
    if let Some(cell) = ENGINE.get() {
        if let Ok(mut g) = cell.lock() {
            *g = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bio_merges_adjacent_person_inside() {
        let t = "ab";
        let v = vec![
            (BioRole::Begin(Category::Person), 0.9, (0, 1)),
            (BioRole::Inside(Category::Person), 0.8, (1, 2)),
        ];
        let s = spans_from_bio(&v, t);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].text, "ab");
        assert_eq!(s[0].category, Category::Person);
    }

    #[test]
    fn bio_detects_org_separately() {
        let t = "ACME Corp";
        let v = vec![
            (BioRole::Begin(Category::Firma), 0.9, (0, 4)),
            (BioRole::Inside(Category::Firma), 0.85, (5, 9)),
        ];
        let s = spans_from_bio(&v, t);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].category, Category::Firma);
    }

    #[test]
    fn label_role_parses_all_bio_types() {
        assert!(matches!(label_role("B-PER"), BioRole::Begin(Category::Person)));
        assert!(matches!(label_role("I-PER"), BioRole::Inside(Category::Person)));
        assert!(matches!(label_role("B-ORG"), BioRole::Begin(Category::Firma)));
        assert!(matches!(label_role("B-LOC"), BioRole::Begin(Category::Ort)));
        assert!(matches!(label_role("B-MISC"), BioRole::Begin(Category::Sonstiges)));
        assert!(matches!(label_role("O"), BioRole::Outside));
    }

    #[test]
    fn bio_flush_on_category_change() {
        let t = "Anna GmbH";
        let v = vec![
            (BioRole::Begin(Category::Person), 0.9, (0, 4)),
            (BioRole::Begin(Category::Firma), 0.9, (5, 9)),
        ];
        let s = spans_from_bio(&v, t);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].category, Category::Person);
        assert_eq!(s[1].category, Category::Firma);
    }
}
