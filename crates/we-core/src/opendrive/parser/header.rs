use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64};
use crate::model::*;

pub(super) fn parse_header(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Header, OpenDriveError> {
    let mut header = parse_header_attrs(start)?;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e))
                if e.name().as_ref() == b"geoReference" =>
            {
                header.geo_reference = Some(parse_geo_reference(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"header" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in header".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(header)
}

pub(super) fn parse_header_attrs(e: &BytesStart) -> Result<Header, OpenDriveError> {
    let mut header = Header::default();
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"revMajor" => header.rev_major = attr_str(&attr)?.parse().unwrap_or(1),
            b"revMinor" => header.rev_minor = attr_str(&attr)?.parse().unwrap_or(0),
            b"name" => header.name = attr_str(&attr)?,
            b"date" => header.date = attr_str(&attr)?,
            b"north" => header.north = parse_f64(&attr)?,
            b"south" => header.south = parse_f64(&attr)?,
            b"east" => header.east = parse_f64(&attr)?,
            b"west" => header.west = parse_f64(&attr)?,
            _ => {}
        }
    }
    Ok(header)
}

fn parse_geo_reference(e: &BytesStart) -> Result<GeoReference, OpenDriveError> {
    let mut geo = GeoReference::default();
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"originLat" => geo.origin_lat = parse_f64(&attr)?,
            b"originLong" => geo.origin_long = parse_f64(&attr)?,
            b"originAlt" => geo.origin_alt = parse_f64(&attr)?,
            b"originHdg" => geo.origin_hdg = parse_f64(&attr)?,
            _ => {}
        }
    }
    Ok(geo)
}
