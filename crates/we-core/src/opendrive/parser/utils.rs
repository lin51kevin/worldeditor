use quick_xml::Reader;
use quick_xml::events::Event;

use super::super::OpenDriveError;

pub(super) fn attr_str(
    attr: &quick_xml::events::attributes::Attribute,
) -> Result<String, OpenDriveError> {
    Ok(String::from_utf8_lossy(&attr.value).into_owned())
}

pub(super) fn parse_f64(
    attr: &quick_xml::events::attributes::Attribute,
) -> Result<f64, OpenDriveError> {
    let s = String::from_utf8_lossy(&attr.value);
    // Fast path: well-formed float
    if let Ok(v) = s.parse::<f64>() {
        return Ok(v);
    }
    // Slow path: handle malformed values like "1.75.000000000000000e+00" (two
    // decimal points). Truncate at the second '.' and retry.
    let mut dot_count = 0usize;
    let mut truncate_at: Option<usize> = None;
    for (i, b) in s.as_bytes().iter().enumerate() {
        if *b == b'.' {
            dot_count += 1;
            if dot_count == 2 {
                truncate_at = Some(i);
                break;
            }
        }
    }
    if let Some(pos) = truncate_at {
        if let Ok(v) = s[..pos].parse::<f64>() {
            return Ok(v);
        }
    }
    Err(OpenDriveError::InvalidStructure(format!(
        "Invalid float value '{}' for attribute '{}'",
        s,
        String::from_utf8_lossy(attr.key.as_ref())
    )))
}

pub(super) fn skip_element(reader: &mut Reader<&[u8]>, name: &[u8]) -> Result<(), OpenDriveError> {
    let mut depth = 1u32;
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == name => depth += 1,
            Ok(Event::End(ref e)) if e.name().as_ref() == name => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }
    Ok(())
}
