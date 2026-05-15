use quick_xml::Writer;
use quick_xml::events::{BytesEnd, BytesStart, Event};

use super::{OpenDriveError, W, elem_with_attrs, f, w_err};
use crate::model::*;

pub(super) fn write_signals(
    writer: &mut Writer<W>,
    signals: &[Signal],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("signals".to_string())))
        .map_err(w_err)?;

    for sig in signals {
        let mut attrs = vec![
            ("s", f(sig.s)),
            ("t", f(sig.t)),
            ("id", sig.id.clone()),
            ("name", sig.name.clone()),
            (
                "dynamic",
                if sig.is_dynamic { "true" } else { "false" }.to_string(),
            ),
            ("orientation", sig.orientation.clone()),
            ("zOffset", f(sig.z_offset)),
            ("hOffset", f(sig.h_offset)),
            ("type", sig.signal_type.clone()),
            ("subtype", sig.signal_subtype.clone()),
            ("width", f(sig.width)),
            ("height", f(sig.height)),
        ];
        if let Some(ref val) = sig.value {
            attrs.push(("value", val.clone()));
        }
        writer
            .write_event(Event::Empty(elem_with_attrs("signal", &attrs)))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("signals".to_string())))
        .map_err(w_err)?;
    Ok(())
}

pub(super) fn write_objects(
    writer: &mut Writer<W>,
    objects: &[RoadObject],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("objects".to_string())))
        .map_err(w_err)?;

    for obj in objects {
        let mut attrs = vec![
            ("s", f(obj.position.x)),
            ("t", f(obj.position.y)),
            ("zOffset", f(obj.position.z)),
            ("id", obj.id.clone()),
            ("name", obj.name.clone()),
            ("type", object_type_str(&obj.object_type)),
            ("orientation", if obj.orientation >= 180.0 { "-" } else { "none" }.to_string()),
            ("hdg", f(obj.hdg)),
            ("pitch", f(obj.pitch)),
            ("roll", f(obj.roll)),
            ("width", f(obj.width)),
            ("height", f(obj.height)),
            ("length", f(obj.length)),
        ];
        if let Some(ref v) = obj.validity {
            attrs.push(("validLength", "0".to_string()));
        }
        if obj.corners.is_empty() {
            writer
                .write_event(Event::Empty(elem_with_attrs("object", &attrs)))
                .map_err(w_err)?;
        } else {
            writer
                .write_event(Event::Start(elem_with_attrs("object", &attrs)))
                .map_err(w_err)?;

            writer
                .write_event(Event::Start(BytesStart::new("outline".to_string())))
                .map_err(w_err)?;
            for corner in &obj.corners {
                let mut corner_attrs = vec![
                    ("height", "0".to_string()),
                    ("u", f(corner.x)),
                    ("v", f(corner.y)),
                    ("z", f(corner.z)),
                ];
                if let Some(ref cid) = corner.id {
                    corner_attrs.push(("id", cid.clone()));
                }
                writer
                    .write_event(Event::Empty(elem_with_attrs("cornerLocal", &corner_attrs)))
                    .map_err(w_err)?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("outline")))
                .map_err(w_err)?;

            if let Some(ref v) = obj.validity {
                let validity_attrs = vec![
                    ("fromLane", v.from_lane.to_string()),
                    ("toLane", v.to_lane.to_string()),
                ];
                writer
                    .write_event(Event::Empty(elem_with_attrs("validity", &validity_attrs)))
                    .map_err(w_err)?;
            }

            for (code, value) in &obj.user_data {
                let ud_attrs = vec![
                    ("code", code.clone()),
                    ("value", value.clone()),
                ];
                writer
                    .write_event(Event::Empty(elem_with_attrs("userData", &ud_attrs)))
                    .map_err(w_err)?;
            }

            writer
                .write_event(Event::End(BytesEnd::new("object")))
                .map_err(w_err)?;
        }
    }

    writer
        .write_event(Event::End(BytesEnd::new("objects".to_string())))
        .map_err(w_err)?;
    Ok(())
}

fn object_type_str(object_type: &ObjectType) -> String {
    match object_type {
        ObjectType::Sign => "sign".to_string(),
        ObjectType::Guardrail => "guardrail".to_string(),
        ObjectType::Barrier => "barrier".to_string(),
        ObjectType::Curb => "curb".to_string(),
        ObjectType::Wall => "wall".to_string(),
        ObjectType::Pillar => "pillar".to_string(),
        ObjectType::TrafficCone => "trafficCone".to_string(),
        ObjectType::ParkingSpace => "parkingSpace".to_string(),
        ObjectType::Crosswalk => "crosswalk".to_string(),
        ObjectType::StopLine => "stopLine".to_string(),
        ObjectType::CrossHatchArea => "crossHatchArea".to_string(),
        ObjectType::WovenArea => "wovenArea".to_string(),
        ObjectType::ForwardWaitingArea => "forwardWaitingArea".to_string(),
        ObjectType::TurnLeftWaitingArea => "turnLeftWaitingArea".to_string(),
        ObjectType::SlowDownToYieldLine => "slowDownToYieldLine".to_string(),
        ObjectType::StopToYieldLine => "stopToYieldLine".to_string(),
        ObjectType::SimpleSignalPole => "simpleSignalPole".to_string(),
        ObjectType::TrafficLightPole => "trafficLightPole".to_string(),
        ObjectType::StreetLightPole => "streetLightPole".to_string(),
        ObjectType::SignGantry => "signGantry".to_string(),
        ObjectType::LTypeSignalPole => "lTypeSignalPole".to_string(),
        ObjectType::Custom(value) => value.clone(),
    }
}

