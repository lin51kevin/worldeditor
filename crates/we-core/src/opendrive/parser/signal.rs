use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64};
use crate::model::road::*;

// ── Signals ──────────────────────────────────────────

/// Parse a `<signals>` block and return all contained signals.
pub(super) fn parse_signals(reader: &mut Reader<&[u8]>) -> Result<Vec<Signal>, OpenDriveError> {
    let mut signals = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"signal" => {
                signals.push(parse_signal_elem(e, reader)?);
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"signal" => {
                signals.push(parse_signal_elem_attrs(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"signals" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in signals".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(signals)
}

/// Parse a `<signal …>…</signal>` element (has child elements).
///
/// Reads the attributes, then consumes children (e.g. `<validity>`) until the
/// closing `</signal>` tag.
fn parse_signal_elem(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<Signal, OpenDriveError> {
    let signal = parse_signal_elem_attrs(start)?;
    // consume any child elements until </signal>
    loop {
        match reader.read_event() {
            Ok(Event::End(ref e)) if e.name().as_ref() == b"signal" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in signal element".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }
    Ok(signal)
}

/// Parse all attributes from a `<signal …>` or `<signal …/>` start/empty tag.
fn parse_signal_elem_attrs(e: &BytesStart) -> Result<Signal, OpenDriveError> {
    let mut signal = Signal {
        id: String::new(),
        name: String::new(),
        s: 0.0,
        t: 0.0,
        z_offset: 0.0,
        h_offset: 0.0,
        width: 0.0,
        height: 0.0,
        signal_type: String::new(),
        signal_subtype: String::new(),
        value: None,
        orientation: "none".to_string(),
        is_dynamic: false,
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => signal.id = attr_str(&attr)?,
            b"name" => signal.name = attr_str(&attr)?,
            b"s" => signal.s = parse_f64(&attr)?,
            b"t" => signal.t = parse_f64(&attr)?,
            b"zOffset" => signal.z_offset = parse_f64(&attr)?,
            b"hOffset" => signal.h_offset = parse_f64(&attr)?,
            b"width" => signal.width = parse_f64(&attr)?,
            b"height" => signal.height = parse_f64(&attr)?,
            b"type" => signal.signal_type = attr_str(&attr)?,
            b"subtype" => signal.signal_subtype = attr_str(&attr)?,
            b"value" => {
                let v = attr_str(&attr)?;
                if !v.is_empty() {
                    signal.value = Some(v);
                }
            }
            b"orientation" => signal.orientation = attr_str(&attr)?,
            b"dynamic" => signal.is_dynamic = attr_str(&attr)?.eq_ignore_ascii_case("yes"),
            _ => {}
        }
    }

    Ok(signal)
}

// ── Objects ──────────────────────────────────────────

/// Parse a `<objects>` block and return all contained road objects.
///
/// Accepts both `<roadObject>` (OpenDRIVE 1.6+) and `<object>` (older/RoadRunner convention).
pub(super) fn parse_objects(reader: &mut Reader<&[u8]>) -> Result<Vec<RoadObject>, OpenDriveError> {
    let mut objects = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e))
                if e.name().as_ref() == b"roadObject" || e.name().as_ref() == b"object" =>
            {
                objects.push(parse_road_object_elem(e, reader)?);
            }
            Ok(Event::Empty(ref e))
                if e.name().as_ref() == b"roadObject" || e.name().as_ref() == b"object" =>
            {
                objects.push(parse_road_object_attrs(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"objects" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in objects".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(objects)
}

/// Parse a `<roadObject …>…</roadObject>` or `<object …>…</object>` element.
///
/// Both tag variants are used across different OpenDRIVE authoring tools:
/// - `<roadObject>` is the OpenDRIVE 1.6+ standard
/// - `<object>` is used by RoadRunner and older toolchains (e.g. CityScape maps)
///
/// Corner geometry may be nested inside an `<outline>` child element; the
/// function transparently reads through that wrapper.
fn parse_road_object_elem(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<RoadObject, OpenDriveError> {
    // Determine which closing tag to look for based on the opening tag name.
    let closing: &[u8] = if start.name().as_ref() == b"object" {
        b"object"
    } else {
        b"roadObject"
    };

    let mut obj = parse_road_object_attrs(start)?;
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e))
                if e.name().as_ref() == b"validity" =>
            {
                let mut from_lane = i32::MIN;
                let mut to_lane = i32::MAX;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"fromLane" => from_lane = attr_str(&attr)?.parse().unwrap_or(i32::MIN),
                        b"toLane" => to_lane = attr_str(&attr)?.parse().unwrap_or(i32::MAX),
                        _ => {}
                    }
                }
                obj.validity = Some(Validity { from_lane, to_lane });
            }
            Ok(Event::Start(ref e) | Event::Empty(ref e))
                if e.name().as_ref() == b"corner"
                    || e.name().as_ref() == b"cornerLocal"
                    || e.name().as_ref() == b"cornerRoad" =>
            {
                // Supports both <cornerLocal> (road-frame u/v) and <cornerRoad> (road-frame s/t).
                // Nested inside an optional <outline> wrapper; the wrapper tag is simply ignored
                // and corner events are captured at any depth within the element.
                let mut s = 0.0f64;
                let mut t = 0.0f64;
                let mut dz = 0.0f64;
                let mut id: Option<String> = None;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"u" | b"s" => s = parse_f64(&attr).unwrap_or(0.0),
                        b"v" | b"t" => t = parse_f64(&attr).unwrap_or(0.0),
                        b"dz" | b"z" => dz = parse_f64(&attr).unwrap_or(0.0),
                        b"id" => id = Some(attr_str(&attr)?),
                        _ => {}
                    }
                }
                obj.corners.push(Point3D::new_with_id(s, t, dz, id));
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == closing => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in roadObject element".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }
    Ok(obj)
}

/// Parse attributes from a `<roadObject …>` tag.
///
/// Note: OpenDRIVE uses road-local coordinates (s/t/zOffset/hdg). We store
/// them as Point3D (x=s, y=t, z=zOffset) as a simplified representation.
/// Full s→XY conversion should be done by the consuming code.
fn parse_road_object_attrs(e: &BytesStart) -> Result<RoadObject, OpenDriveError> {
    let mut obj = RoadObject {
        id: String::new(),
        object_type: ObjectType::Custom(String::new()),
        name: String::new(),
        position: Point3D::new(0.0, 0.0, 0.0),
        orientation: 0.0,
        width: 0.0,
        height: 0.0,
        length: 0.0,
        corners: Vec::new(),
        validity: None,
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => obj.id = attr_str(&attr)?,
            b"name" => obj.name = attr_str(&attr)?,
            b"type" => obj.object_type = parse_object_type(&attr_str(&attr)?),
            b"s" => obj.position.x = parse_f64(&attr)?, // simplified: x = s
            b"t" => obj.position.y = parse_f64(&attr)?, // simplified: y = t
            b"zOffset" => obj.position.z = parse_f64(&attr)?,
            b"orientation" => {
                // "none" -> 0.0, "+" -> 0.0, "-" -> 180.0
                let v = attr_str(&attr)?;
                obj.orientation = match v.as_str() {
                    "-" => 180.0,
                    _ => 0.0,
                };
            }
            b"width" => obj.width = parse_f64(&attr)?,
            b"height" => obj.height = parse_f64(&attr)?,
            b"length" => obj.length = parse_f64(&attr)?,
            // hdg, pitch, roll — not stored in current model but accepted
            _ => {}
        }
    }

    Ok(obj)
}

fn parse_object_type(s: &str) -> ObjectType {
    match s {
        "barrier" => ObjectType::Barrier,
        "guardrail" | "Guardrail" | "RoadGuardrail" => ObjectType::Guardrail,
        "sign" | "signal" => ObjectType::Sign,
        "curb" | "Curb" => ObjectType::Curb,
        "wall" | "Wall" => ObjectType::Wall,
        "pole" | "pillar" | "Pillar" => ObjectType::Pillar,
        "trafficCone" | "cone" | "TrafficCone" => ObjectType::TrafficCone,
        "parkingSpace" | "ParkingSpace" | "SlotSpace" => ObjectType::ParkingSpace,
        "crosswalk" | "Crosswalk" | "ZebraStripsArea" | "zebra" => ObjectType::Crosswalk,
        "stopLine" | "StopLine" => ObjectType::StopLine,
        "crossHatchArea" | "CrossHatchArea" | "SimpleCrossHatch" => ObjectType::CrossHatchArea,
        "wovenArea" | "WovenArea" => ObjectType::WovenArea,
        "forwardWaitingArea" | "ForwardWaitingArea" => ObjectType::ForwardWaitingArea,
        "turnLeftWaitingArea" | "TurnLeftWaitingArea" => ObjectType::TurnLeftWaitingArea,
        "slowDownToYieldLine" | "SlowDownToYieldLine" => ObjectType::SlowDownToYieldLine,
        "stopToYieldLine" | "StopToYieldLine" => ObjectType::StopToYieldLine,
        "simpleSignalPole" | "SimpleSignalPole" => ObjectType::SimpleSignalPole,
        "trafficLightPole" | "TrafficLightPole" => ObjectType::TrafficLightPole,
        "streetLightPole" | "StreetLightPole" => ObjectType::StreetLightPole,
        "signGantry" | "SignGantry" => ObjectType::SignGantry,
        "lTypeSignalPole" | "LTypeSignalPole" => ObjectType::LTypeSignalPole,
        _ => ObjectType::Custom(s.to_string()),
    }
}
