use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::attr_str;
use crate::model::*;

pub(super) fn parse_junction(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<Junction, OpenDriveError> {
    let mut junction = Junction {
        id: String::new(),
        name: String::new(),
        connections: Vec::new(),
    };

    for attr in start.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => junction.id = attr_str(&attr)?,
            b"name" => junction.name = attr_str(&attr)?,
            _ => {}
        }
    }

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"connection" => {
                junction
                    .connections
                    .push(parse_junction_connection(e, reader)?);
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"connection" => {
                junction
                    .connections
                    .push(parse_junction_connection_empty(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"junction" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in junction".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(junction)
}

fn parse_junction_connection_empty(e: &BytesStart) -> Result<JunctionConnection, OpenDriveError> {
    let mut conn = JunctionConnection {
        id: String::new(),
        incoming_road: String::new(),
        connecting_road: String::new(),
        contact_point: ContactPoint::Start,
        lane_links: Vec::new(),
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => conn.id = attr_str(&attr)?,
            b"incomingRoad" => conn.incoming_road = attr_str(&attr)?,
            b"connectingRoad" => conn.connecting_road = attr_str(&attr)?,
            b"contactPoint" => {
                conn.contact_point = match attr_str(&attr)?.as_str() {
                    "end" => ContactPoint::End,
                    _ => ContactPoint::Start,
                };
            }
            _ => {}
        }
    }

    Ok(conn)
}

fn parse_junction_connection(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<JunctionConnection, OpenDriveError> {
    let mut conn = parse_junction_connection_empty(start)?;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) if e.name().as_ref() == b"laneLink" => {
                let mut from = 0;
                let mut to = 0;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"from" => from = attr_str(&attr)?.parse().unwrap_or(0),
                        b"to" => to = attr_str(&attr)?.parse().unwrap_or(0),
                        _ => {}
                    }
                }
                conn.lane_links.push(JunctionLaneLink { from, to });
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"connection" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in connection".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(conn)
}
