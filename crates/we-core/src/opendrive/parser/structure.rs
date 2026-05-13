use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64};
use crate::model::*;

// ── Lateral Profile ─────────────────────────────────

pub(super) fn parse_lateral_profile(reader: &mut Reader<&[u8]>) -> Result<LateralProfile, OpenDriveError> {
    let mut profile = LateralProfile::default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => match e.name().as_ref() {
                b"superelevation" => profile.superelevations.push(parse_superelevation(e)?),
                b"crossfall" => profile.crossfalls.push(parse_crossfall(e)?),
                _ => {}
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"lateralProfile" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in lateralProfile".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(profile)
}

fn parse_superelevation(e: &BytesStart) -> Result<Superelevation, OpenDriveError> {
    let (mut s, mut a, mut b, mut c, mut d) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"s" => s = parse_f64(&attr)?,
            b"a" => a = parse_f64(&attr)?,
            b"b" => b = parse_f64(&attr)?,
            b"c" => c = parse_f64(&attr)?,
            b"d" => d = parse_f64(&attr)?,
            _ => {}
        }
    }
    Ok(Superelevation { s, a, b, c, d })
}

fn parse_crossfall(e: &BytesStart) -> Result<Crossfall, OpenDriveError> {
    let (mut s, mut a, mut b, mut c, mut d) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let mut side = CrossfallSide::Both;
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"s" => s = parse_f64(&attr)?,
            b"a" => a = parse_f64(&attr)?,
            b"b" => b = parse_f64(&attr)?,
            b"c" => c = parse_f64(&attr)?,
            b"d" => d = parse_f64(&attr)?,
            b"side" => {
                side = match attr_str(&attr)?.to_lowercase().as_str() {
                    "left" => CrossfallSide::Left,
                    "right" => CrossfallSide::Right,
                    _ => CrossfallSide::Both,
                };
            }
            _ => {}
        }
    }
    Ok(Crossfall { s, a, b, c, d, side })
}

// ── Bridge / Tunnel ─────────────────────────────────

pub(super) fn parse_bridge_empty(e: &BytesStart) -> Result<Bridge, OpenDriveError> {
    let mut bridge = Bridge {
        id: String::new(),
        s: 0.0,
        length: 0.0,
        bridge_type: String::new(),
    };
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => bridge.id = attr_str(&attr)?,
            b"s" => bridge.s = parse_f64(&attr)?,
            b"length" => bridge.length = parse_f64(&attr)?,
            b"type" => bridge.bridge_type = attr_str(&attr)?,
            _ => {}
        }
    }
    Ok(bridge)
}

pub(super) fn parse_bridge(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Bridge, OpenDriveError> {
    let bridge = parse_bridge_empty(start)?;
    loop {
        match reader.read_event() {
            Ok(Event::End(ref e)) if e.name().as_ref() == b"bridge" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure("Unexpected EOF in bridge".into()));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }
    Ok(bridge)
}

pub(super) fn parse_tunnel_empty(e: &BytesStart) -> Result<Tunnel, OpenDriveError> {
    let mut tunnel = Tunnel {
        id: String::new(),
        s: 0.0,
        length: 0.0,
        tunnel_type: String::new(),
    };
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => tunnel.id = attr_str(&attr)?,
            b"s" => tunnel.s = parse_f64(&attr)?,
            b"length" => tunnel.length = parse_f64(&attr)?,
            b"type" => tunnel.tunnel_type = attr_str(&attr)?,
            _ => {}
        }
    }
    Ok(tunnel)
}

pub(super) fn parse_tunnel(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Tunnel, OpenDriveError> {
    let tunnel = parse_tunnel_empty(start)?;
    loop {
        match reader.read_event() {
            Ok(Event::End(ref e)) if e.name().as_ref() == b"tunnel" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure("Unexpected EOF in tunnel".into()));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }
    Ok(tunnel)
}
