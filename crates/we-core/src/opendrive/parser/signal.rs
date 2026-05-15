use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64};
use crate::model::*;

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
    let mut signal = parse_signal_elem_attrs(start)?;
    // parse child elements (validity, etc.) until </signal>
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e))
                if e.name().as_ref() == b"validity" =>
            {
                let mut from_lane = i32::MIN;
                let mut to_lane = i32::MAX;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"fromLane" => {
                            from_lane = attr_str(&attr)?.parse().unwrap_or(i32::MIN)
                        }
                        b"toLane" => to_lane = attr_str(&attr)?.parse().unwrap_or(i32::MAX),
                        _ => {}
                    }
                }
                signal.validities.push(Validity { from_lane, to_lane });
            }
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
        country: String::new(),
        unit: String::new(),
        validities: Vec::new(),
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
            b"country" => signal.country = attr_str(&attr)?,
            b"unit" => signal.unit = attr_str(&attr)?,
            _ => {}
        }
    }

    Ok(signal)
}

// ── Objects ──────────────────────────────────────────

/// A pending `<objectReference>` found inside an `<objects>` block.
///
/// These are resolved after all roads have been parsed, in the main `parse()` function.
/// Parsed data from an `<objectReference>` element.
///
/// Currently retained for future cross-road validation but not used
/// to create copies (objects render on their defining road only).
#[allow(dead_code)]
pub(super) struct ObjectRef {
    /// The id of the referenced `<object>` or `<roadObject>` element (on any road).
    pub id: String,
    /// Road-station position on the *referencing* road.
    pub s: f64,
    /// Lateral offset on the *referencing* road.
    pub t: f64,
    pub z_offset: f64,
}

/// Parse a `<objects>` block.
///
/// Returns `(objects, pending_refs)` where `pending_refs` are `<objectReference>` entries
/// that must be resolved after all roads are parsed (they reference objects on other roads).
///
/// Accepts both `<roadObject>` (OpenDRIVE 1.6+) and `<object>` (older/RoadRunner convention).
pub(super) fn parse_objects(
    reader: &mut Reader<&[u8]>,
) -> Result<(Vec<RoadObject>, Vec<ObjectRef>), OpenDriveError> {
    let mut objects = Vec::new();
    let mut pending_refs = Vec::new();

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
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"objectReference" => {
                let mut id = String::new();
                let mut s = 0.0f64;
                let mut t = 0.0f64;
                let mut z_offset = 0.0f64;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"id" => id = attr_str(&attr)?,
                        b"s" => s = parse_f64(&attr)?,
                        b"t" => t = parse_f64(&attr)?,
                        b"zOffset" => z_offset = parse_f64(&attr)?,
                        _ => {}
                    }
                }
                if !id.is_empty() {
                    pending_refs.push(ObjectRef { id, s, t, z_offset });
                }
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

    Ok((objects, pending_refs))
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
                // <cornerLocal> uses (u, v, z/dz) in the object's local frame.
                // <cornerRoad> uses (s, t, dz) in absolute road coordinates.
                // <corner> is a legacy alias for <cornerLocal>.
                let is_road = e.name().as_ref() == b"cornerRoad";
                let mut s = 0.0f64;
                let mut t = 0.0f64;
                let mut dz = 0.0f64;
                let mut height = 0.0f64;
                let mut id: Option<String> = None;
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"u" | b"s" => s = parse_f64(&attr).unwrap_or(0.0),
                        b"v" | b"t" => t = parse_f64(&attr).unwrap_or(0.0),
                        b"dz" | b"z" => dz = parse_f64(&attr).unwrap_or(0.0),
                        b"height" => height = parse_f64(&attr).unwrap_or(0.0),
                        b"id" => id = Some(attr_str(&attr)?),
                        _ => {}
                    }
                }
                // Store height in id field as auxiliary data (height is rarely used
                // for ground objects but parsed for completeness — Bug 9 fix).
                let _ = height; // currently unused; available for future 3D extrusion
                obj.corners.push(Point3D::new_with_id(s, t, dz, id));
                if is_road {
                    obj.corner_type = CornerType::Road;
                }
            }
            Ok(Event::Start(ref e) | Event::Empty(ref e))
                if e.name().as_ref() == b"userData" =>
            {
                let mut code = String::new();
                let mut value = String::new();
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"code" => code = attr_str(&attr)?,
                        b"value" => value = attr_str(&attr)?,
                        _ => {}
                    }
                }
                if !code.is_empty() {
                    obj.user_data.push((code, value));
                }
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
    // Normalise: some xodr files repeat the first corner at the end as a closing vertex.
    // Remove it here so renderers never need to handle it.
    if obj.corners.len() >= 4 {
        let first = obj.corners[0].clone();
        let last = &obj.corners[obj.corners.len() - 1];
        if (first.x - last.x).abs() < 1e-9 && (first.y - last.y).abs() < 1e-9 {
            obj.corners.pop();
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
        hdg: 0.0,
        pitch: 0.0,
        roll: 0.0,
        width: 0.0,
        height: 0.0,
        length: 0.0,
        corners: Vec::new(),
        corner_type: CornerType::Local,
        validity: None,
        from_object_ref: false,
        user_data: Vec::new(),
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
            b"hdg" => obj.hdg = parse_f64(&attr)?,
            b"pitch" => obj.pitch = parse_f64(&attr).unwrap_or(0.0),
            b"roll" => obj.roll = parse_f64(&attr).unwrap_or(0.0),
            b"width" => obj.width = parse_f64(&attr)?,
            b"height" => obj.height = parse_f64(&attr)?,
            b"length" => obj.length = parse_f64(&attr)?,
            _ => {}
        }
    }

    Ok(obj)
}

fn parse_object_type(s: &str) -> ObjectType {
    match s.to_lowercase().as_str() {
        "barrier" => ObjectType::Barrier,
        "guardrail" | "roadguardrail" => ObjectType::Guardrail,
        "sign" | "signal" => ObjectType::Sign,
        "curb" => ObjectType::Curb,
        "wall" => ObjectType::Wall,
        "pole" | "pillar" => ObjectType::Pillar,
        "trafficcone" | "cone" => ObjectType::TrafficCone,
        "parkingspace" | "slotspace" => ObjectType::ParkingSpace,
        "crosswalk" | "zebrastripsarea" | "zebra" => ObjectType::Crosswalk,
        "stopline" => ObjectType::StopLine,
        "crosshatcharea" | "simplecrosshatch" => ObjectType::CrossHatchArea,
        "wovenarea" => ObjectType::WovenArea,
        "forwardwaitingarea" => ObjectType::ForwardWaitingArea,
        "turnleftwaitingarea" => ObjectType::TurnLeftWaitingArea,
        "slowdowntoyieldline" => ObjectType::SlowDownToYieldLine,
        "stoptoyieldline" => ObjectType::StopToYieldLine,
        "simplesignalpole" => ObjectType::SimpleSignalPole,
        "trafficlightpole" => ObjectType::TrafficLightPole,
        "streetlightpole" => ObjectType::StreetLightPole,
        "signgantry" => ObjectType::SignGantry,
        "ltypesignalpole" => ObjectType::LTypeSignalPole,
        _ => ObjectType::Custom(s.to_string()), // preserve original casing in fallback
    }
}
