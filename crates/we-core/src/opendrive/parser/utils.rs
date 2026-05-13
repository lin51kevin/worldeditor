use quick_xml::Reader;
use quick_xml::events::Event;

use super::super::OpenDriveError;

pub(super) fn attr_str(attr: &quick_xml::events::attributes::Attribute) -> Result<String, OpenDriveError> {
    Ok(String::from_utf8_lossy(&attr.value).into_owned())
}

pub(super) fn parse_f64(attr: &quick_xml::events::attributes::Attribute) -> Result<f64, OpenDriveError> {
    let s = String::from_utf8_lossy(&attr.value);
    s.parse::<f64>().map_err(|_| {
        OpenDriveError::InvalidStructure(format!(
            "Invalid float value '{}' for attribute '{}'",
            s,
            String::from_utf8_lossy(attr.key.as_ref())
        ))
    })
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
