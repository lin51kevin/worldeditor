use quick_xml::Writer;
use quick_xml::events::{BytesEnd, BytesStart, Event};

use super::{OpenDriveError, W, elem_with_attrs, f, w_err};
use crate::model::*;

pub(super) fn write_lanes(
    writer: &mut Writer<W>,
    sections: &[LaneSection],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("lanes".to_string())))
        .map_err(w_err)?;

    for section in sections {
        let mut attrs = vec![("s", f(section.s))];
        if section.single_side {
            attrs.push(("singleSide", "1".to_string()));
        }
        writer
            .write_event(Event::Start(elem_with_attrs("laneSection", &attrs)))
            .map_err(w_err)?;

        if !section.left.is_empty() {
            write_lane_group(writer, "left", &section.left)?;
        }
        if !section.center.is_empty() {
            write_lane_group(writer, "center", &section.center)?;
        }
        if !section.right.is_empty() {
            write_lane_group(writer, "right", &section.right)?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("laneSection".to_string())))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("lanes".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_lane_group(
    writer: &mut Writer<W>,
    tag: &str,
    lanes: &[Lane],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new(tag.to_string())))
        .map_err(w_err)?;

    for lane in lanes {
        write_lane(writer, lane)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new(tag.to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_lane(writer: &mut Writer<W>, lane: &Lane) -> Result<(), OpenDriveError> {
    let attrs = [
        ("id", lane.id.to_string()),
        ("level", lane.level.to_string()),
        ("type", lane_type_str(lane.lane_type).to_string()),
    ];
    let elem = elem_with_attrs("lane", &attrs);

    let has_children = lane.link.is_some() || !lane.width.is_empty() || !lane.road_marks.is_empty();

    if !has_children {
        writer.write_event(Event::Empty(elem)).map_err(w_err)?;
        return Ok(());
    }

    writer.write_event(Event::Start(elem)).map_err(w_err)?;

    if let Some(ref link) = lane.link {
        writer
            .write_event(Event::Start(BytesStart::new("link".to_string())))
            .map_err(w_err)?;

        if let Some(pred) = link.predecessor {
            writer
                .write_event(Event::Empty(elem_with_attrs(
                    "predecessor",
                    &[("id", pred.to_string())],
                )))
                .map_err(w_err)?;
        }
        if let Some(succ) = link.successor {
            writer
                .write_event(Event::Empty(elem_with_attrs(
                    "successor",
                    &[("id", succ.to_string())],
                )))
                .map_err(w_err)?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("link".to_string())))
            .map_err(w_err)?;
    }

    for w in &lane.width {
        let attrs = [
            ("sOffset", f(w.s_offset)),
            ("a", f(w.a)),
            ("b", f(w.b)),
            ("c", f(w.c)),
            ("d", f(w.d)),
        ];
        writer
            .write_event(Event::Empty(elem_with_attrs("width", &attrs)))
            .map_err(w_err)?;
    }

    for mark in &lane.road_marks {
        let mut attrs = vec![
            ("sOffset", f(mark.s_offset)),
            ("type", road_mark_type_str(mark.mark_type).to_string()),
            ("weight", road_mark_weight_str(mark.weight).to_string()),
            ("color", road_mark_color_str(mark.color).to_string()),
            ("material", mark.material.clone()),
            ("width", f(mark.width)),
        ];
        if !mark.lane_change.is_empty() {
            attrs.push(("laneChange", mark.lane_change.clone()));
        }
        attrs.push(("height", f(mark.height)));
        writer
            .write_event(Event::Empty(elem_with_attrs("roadMark", &attrs)))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("lane".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn road_mark_type_str(t: RoadMarkType) -> &'static str {
    match t {
        RoadMarkType::Solid => "solid",
        RoadMarkType::Broken => "broken",
        RoadMarkType::SolidBroken => "solid broken",
        RoadMarkType::BrokenSolid => "broken solid",
        RoadMarkType::BottsDots => "botts dots",
        RoadMarkType::Grass => "grass",
        RoadMarkType::Curb => "curb",
        RoadMarkType::SolidSolid => "solid solid",
        RoadMarkType::StopLine => "stop line",
        RoadMarkType::Custom => "custom",
        RoadMarkType::None => "none",
    }
}

fn road_mark_color_str(c: RoadMarkColor) -> &'static str {
    match c {
        RoadMarkColor::Standard => "standard",
        RoadMarkColor::White => "white",
        RoadMarkColor::Yellow => "yellow",
        RoadMarkColor::Red => "red",
        RoadMarkColor::Blue => "blue",
        RoadMarkColor::Green => "green",
        RoadMarkColor::Orange => "orange",
        RoadMarkColor::Violet => "violet",
    }
}

fn road_mark_weight_str(w: RoadMarkWeight) -> &'static str {
    match w {
        RoadMarkWeight::Standard => "standard",
        RoadMarkWeight::Bold => "bold",
    }
}

fn lane_type_str(lt: LaneType) -> &'static str {
    match lt {
        LaneType::Driving => "driving",
        LaneType::Shoulder => "shoulder",
        LaneType::Sidewalk => "sidewalk",
        LaneType::Border => "border",
        LaneType::Parking => "parking",
        LaneType::Median => "median",
        LaneType::Curb => "curb",
        LaneType::Stop => "stop",
        LaneType::Biking => "biking",
        LaneType::Restricted => "restricted",
        LaneType::Bidirectional => "bidirectional",
        LaneType::Rail => "rail",
        LaneType::Tram => "tram",
        LaneType::Bus => "bus",
        LaneType::Taxi => "taxi",
        LaneType::HOV => "hov",
        LaneType::Entry => "entry",
        LaneType::Exit => "exit",
        LaneType::OffRamp => "offRamp",
        LaneType::OnRamp => "onRamp",
        LaneType::ConnectingRamp => "connectingRamp",
        LaneType::Special1 => "special1",
        LaneType::Special2 => "special2",
        LaneType::Special3 => "special3",
        LaneType::RoadWorks => "roadWorks",
        LaneType::None => "none",
    }
}
