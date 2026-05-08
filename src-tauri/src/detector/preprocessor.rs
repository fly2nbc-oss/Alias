//! Textvorbereitung vor der Erkennung.
//! Wichtig: Keine umsetzbaren Längenänderungen am `str`, sonst stimmen Byte-Offsets nicht mehr
//! mit dem im Editor angezeigten Text überein. Erweiterungen (NFKC, NBSP→Space) nur mit Offset-Mapping.

/// Aktuell: Identität — später ggf. Längen-konformes Mapping oder paralleler Normalform-Text für NER.
pub fn prepare_for_detection(text: &str) -> &str {
    text
}

/// Die Hugging-Face-Tokenizer-Offsets für NER sind **Byte-Indizes im gleichen `str`**, der auch an
/// `detect_all` übergeben wird. Solange kein separates Normalisierungs-Mapping existiert, bleiben
/// UI- und NER-Offsets konsistent.
#[cfg_attr(not(test), allow(dead_code))]
pub fn ner_uses_byte_offsets_in_source_text() -> bool {
    true
}
