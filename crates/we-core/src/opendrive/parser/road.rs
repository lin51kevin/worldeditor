use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::geometry::{parse_elevation_profile, parse_plan_view};
use super::lane::parse_lanes;
use super::signal::{parse_objects, parse_signals, ObjectRef};
use super::structure::{
    parse_bridge, parse_bridge_empty, parse_lateral_profile, parse_tunnel, parse_tunnel_empty,
};
use super::utils::{attr_str, parse_f64, skip_element};
use crate::model::*;

pub(super) fn parse_road(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<(Road, Vec<ObjectRef>), OpenDriveError> {
    let mut road = Road::new("", 0.0);
    let mut pending_refs: Vec<ObjectRef> = Vec::new();

    for attr in start.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => road.id = attr_str(&attr)?,
            b"name" => road.name = attr_str(&attr)?,
            b"length" => road.length = parse_f64(&attr)?,
            b"junction" => {
                let val = attr_str(&attr)?;
                road.junction_id = if val == "-1" { None } else { Some(val) };
            }
            _ => {}
        }
    }

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"link" => road.link = Some(parse_road_link(reader)?),
                b"planView" => road.plan_view = parse_plan_view(reader)?,
                b"elevationProfile" => road.elevation_profile = parse_elevation_profile(reader)?,
                b"lanes" => {
                    let (sections, offsets) = parse_lanes(reader)?;
                    road.lane_sections = sections;
                    road.lane_offsets = offsets;
                }
                b"lateralProfile" => road.lateral_profile = parse_lateral_profile(reader)?,
                b"bridge" => road.bridges.push(parse_bridge(e, reader)?),
                b"tunnel" => road.tunnels.push(parse_tunnel(e, reader)?),
                b"signals" => road.signals = parse_signals(reader)?,
                b"objects" => {
                    let (objs, refs) = parse_objects(reader)?;
                    road.objects = objs;
                    pending_refs.extend(refs);
                }
                _ => skip_element(reader, e.name().as_ref())?,
            },
            Ok(Event::Empty(ref e)) => match e.name().as_ref() {
                b"bridge" => road.bridges.push(parse_bridge_empty(e)?),
                b"tunnel" => road.tunnels.push(parse_tunnel_empty(e)?),
                _ => {}
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"road" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in road".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok((road, pending_refs))
}

// ── Road Link ────────────────────────────────────────

fn parse_road_link(reader: &mut Reader<&[u8]>) -> Result<RoadLink, OpenDriveError> {
    let mut link = RoadLink {
        predecessor: None,
        successor: None,
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => match e.name().as_ref() {
                b"predecessor" => link.predecessor = Some(parse_link_element(e)?),
                b"successor" => link.successor = Some(parse_link_element(e)?),
                _ => {}
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"link" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in link".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(link)
}

fn parse_link_element(e: &BytesStart) -> Result<LinkElement, OpenDriveError> {
    let mut elem = LinkElement {
        element_type: LinkElementType::Road,
        element_id: String::new(),
        contact_point: None,
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"elementType" => {
                elem.element_type = match attr_str(&attr)?.as_str() {
                    "junction" => LinkElementType::Junction,
                    _ => LinkElementType::Road,
                };
            }
            b"elementId" => elem.element_id = attr_str(&attr)?,
            b"contactPoint" => {
                elem.contact_point = Some(match attr_str(&attr)?.as_str() {
                    "end" => ContactPoint::End,
                    _ => ContactPoint::Start,
                });
            }
            _ => {}
        }
    }

    Ok(elem)
}
