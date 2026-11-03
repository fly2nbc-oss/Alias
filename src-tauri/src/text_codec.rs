//! Lesen/Schreiben von Textdateien unter Erhalt der Originalkodierung
//! (UTF-8 mit/ohne BOM, UTF-16 LE/BE mit BOM, sonst Windows-1252).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

pub fn decode(bytes: &[u8]) -> (String, TextEncoding) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), TextEncoding::Utf8Bom);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return (decode_utf16(rest, u16::from_le_bytes), TextEncoding::Utf16Le);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return (decode_utf16(rest, u16::from_be_bytes), TextEncoding::Utf16Be);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), TextEncoding::Utf8),
        Err(_) => {
            let (s, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
            (s.into_owned(), TextEncoding::Windows1252)
        }
    }
}

pub fn encode(text: &str, enc: TextEncoding) -> Vec<u8> {
    match enc {
        TextEncoding::Utf8 => text.as_bytes().to_vec(),
        TextEncoding::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        TextEncoding::Utf16Le => {
            let mut v = vec![0xFF, 0xFE];
            text.encode_utf16().for_each(|u| v.extend_from_slice(&u.to_le_bytes()));
            v
        }
        TextEncoding::Utf16Be => {
            let mut v = vec![0xFE, 0xFF];
            text.encode_utf16().for_each(|u| v.extend_from_slice(&u.to_be_bytes()));
            v
        }
        TextEncoding::Windows1252 => {
            // Nicht darstellbare Zeichen werden zu numerischen Entities — kommt nur vor,
            // wenn ein Alias Zeichen außerhalb von Windows-1252 enthält.
            let (b, _, _) = encoding_rs::WINDOWS_1252.encode(text);
            b.into_owned()
        }
    }
}

fn decode_utf16(bytes: &[u8], f: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| f([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_encodings() {
        let s = "Grüße, Jürgen Müller\r\n";
        for enc in [
            TextEncoding::Utf8,
            TextEncoding::Utf8Bom,
            TextEncoding::Utf16Le,
            TextEncoding::Utf16Be,
            TextEncoding::Windows1252,
        ] {
            let bytes = encode(s, enc);
            let (back, detected) = decode(&bytes);
            assert_eq!(back, s);
            assert_eq!(detected, enc);
        }
    }
}
