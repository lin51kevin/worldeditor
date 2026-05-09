//! OpenDRIVE XML writer using quick-xml.
//!
//! Serializes domain model types to `.xodr` XML format.

use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use std::io::Cursor;

use super::OpenDriveError;
use crate::model::road::*;
use crate::model::*;

type W = Cursor<Vec<u8>>;

fn w_err(e: std::io::Error) -> OpenDriveError {
    OpenDriveError::InvalidStructure(format!("IO write error: {e}"))
}

/// Helper: create BytesStart with attributes from slice of (&str, String) pairs.
fn elem_with_attrs(tag: &str, attrs: &[(&str, String)]) -> BytesStart<'static> {
    let mut e = BytesStart::new(tag.to_string());
    for (k, v) in attrs {
        e.push_attribute((*k, v.as_str()));
    }
    e
}

fn f(v: f64) -> String {
    if v == 0.0 {
        "0".to_string()
    } else if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{:.1}", v)
    } else {
        format!("{}", v)
    }
}

/// Serialize a Project to OpenDRIVE XML string.
pub fn write(project: &Project) -> Result<String, OpenDriveError> {
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);

    writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
        .map_err(w_err)?;

    let root = BytesStart::new("OpenDRIVE".to_string());
    writer.write_event(Event::Start(root)).map_err(w_err)?;

    write_header(&mut writer, &project.header)?;

    for road in &project.roads {
        write_road(&mut writer, road)?;
    }

    for junction in &project.junctions {
        write_junction(&mut writer, junction)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("OpenDRIVE".to_string())))
        .map_err(w_err)?;

    let buf = writer.into_inner().into_inner();
    String::from_utf8(buf).map_err(|e| OpenDriveError::InvalidStructure(e.to_string()))
}

// ── Header ───────────────────────────────────────────

fn write_header(writer: &mut Writer<W>, header: &Header) -> Result<(), OpenDriveError> {
    let attrs = [
        ("revMajor", header.rev_major.to_string()),
        ("revMinor", header.rev_minor.to_string()),
        ("name", header.name.clone()),
        ("date", header.date.clone()),
        ("north", f(header.north)),
        ("south", f(header.south)),
        ("east", f(header.east)),
        ("west", f(header.west)),
    ];
    let elem = elem_with_attrs("header", &attrs);

    if let Some(ref geo) = header.geo_reference {
        writer.write_event(Event::Start(elem)).map_err(w_err)?;

        let geo_attrs = [
            ("originLat", f(geo.origin_lat)),
            ("originLong", f(geo.origin_long)),
            ("originAlt", f(geo.origin_alt)),
            ("originHdg", f(geo.origin_hdg)),
        ];
        writer
            .write_event(Event::Empty(elem_with_attrs("geoReference", &geo_attrs)))
            .map_err(w_err)?;

        writer
            .write_event(Event::End(BytesEnd::new("header".to_string())))
            .map_err(w_err)?;
    } else {
        writer.write_event(Event::Empty(elem)).map_err(w_err)?;
    }

    Ok(())
}

// ── Road ─────────────────────────────────────────────

fn write_road(writer: &mut Writer<W>, road: &Road) -> Result<(), OpenDriveError> {
    let attrs = [
        ("id", road.id.clone()),
        (
            "junction",
            road.junction_id.clone().unwrap_or_else(|| "-1".into()),
        ),
        ("length", f(road.length)),
        ("name", road.name.clone()),
    ];
    writer
        .write_event(Event::Start(elem_with_attrs("road", &attrs)))
        .map_err(w_err)?;

    if let Some(ref link) = road.link {
        write_road_link(writer, link)?;
    }

    write_plan_view(writer, &road.plan_view)?;
    write_elevation_profile(writer, &road.elevation_profile)?;
    write_lanes(writer, &road.lane_sections)?;

    writer
        .write_event(Event::End(BytesEnd::new("road".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_road_link(writer: &mut Writer<W>, link: &RoadLink) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("link".to_string())))
        .map_err(w_err)?;

    if let Some(ref pred) = link.predecessor {
        write_link_element(writer, "predecessor", pred)?;
    }
    if let Some(ref succ) = link.successor {
        write_link_element(writer, "successor", succ)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("link".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_link_element(
    writer: &mut Writer<W>,
    tag: &str,
    elem: &LinkElement,
) -> Result<(), OpenDriveError> {
    let et = match elem.element_type {
        LinkElementType::Road => "road",
        LinkElementType::Junction => "junction",
    };
    let mut attrs = vec![
        ("elementType", et.to_string()),
        ("elementId", elem.element_id.clone()),
    ];
    if let Some(cp) = elem.contact_point {
        attrs.push((
            "contactPoint",
            match cp {
                ContactPoint::Start => "start",
                ContactPoint::End => "end",
            }
            .to_string(),
        ));
    }
    writer
        .write_event(Event::Empty(elem_with_attrs(tag, &attrs)))
        .map_err(w_err)?;

    Ok(())
}

// ── Plan View ────────────────────────────────────────

fn write_plan_view(writer: &mut Writer<W>, geometries: &[Geometry]) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("planView".to_string())))
        .map_err(w_err)?;

    for geo in geometries {
        let attrs = [
            ("hdg", f(geo.hdg)),
            ("length", f(geo.length)),
            ("s", f(geo.s)),
            ("x", f(geo.x)),
            ("y", f(geo.y)),
        ];
        writer
            .write_event(Event::Start(elem_with_attrs("geometry", &attrs)))
            .map_err(w_err)?;

        write_geometry_type(writer, &geo.geo_type)?;

        writer
            .write_event(Event::End(BytesEnd::new("geometry".to_string())))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("planView".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_geometry_type(
    writer: &mut Writer<W>,
    geo_type: &GeometryType,
) -> Result<(), OpenDriveError> {
    let event = match geo_type {
        GeometryType::Line => Event::Empty(BytesStart::new("line".to_string())),
        GeometryType::Arc { curvature } => {
            Event::Empty(elem_with_attrs("arc", &[("curvature", f(*curvature))]))
        }
        GeometryType::Spiral {
            curv_start,
            curv_end,
        } => Event::Empty(elem_with_attrs(
            "spiral",
            &[("curvStart", f(*curv_start)), ("curvEnd", f(*curv_end))],
        )),
        GeometryType::Poly3 { a, b, c, d } => Event::Empty(elem_with_attrs(
            "poly3",
            &[("a", f(*a)), ("b", f(*b)), ("c", f(*c)), ("d", f(*d))],
        )),
        GeometryType::ParamPoly3 {
            a_u,
            b_u,
            c_u,
            d_u,
            a_v,
            b_v,
            c_v,
            d_v,
            p_range,
        } => {
            let range_str = match p_range {
                ParamPoly3Range::ArcLength => "arcLength",
                ParamPoly3Range::Normalized => "normalized",
            };
            Event::Empty(elem_with_attrs(
                "paramPoly3",
                &[
                    ("aU", f(*a_u)),
                    ("bU", f(*b_u)),
                    ("cU", f(*c_u)),
                    ("dU", f(*d_u)),
                    ("aV", f(*a_v)),
                    ("bV", f(*b_v)),
                    ("cV", f(*c_v)),
                    ("dV", f(*d_v)),
                    ("pRange", range_str.to_string()),
                ],
            ))
        }
    };
    writer.write_event(event).map_err(w_err)?;
    Ok(())
}

// ── Elevation ────────────────────────────────────────

fn write_elevation_profile(
    writer: &mut Writer<W>,
    elevations: &[Elevation],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new(
            "elevationProfile".to_string(),
        )))
        .map_err(w_err)?;

    for elev in elevations {
        let attrs = [
            ("a", f(elev.a)),
            ("b", f(elev.b)),
            ("c", f(elev.c)),
            ("d", f(elev.d)),
            ("s", f(elev.s)),
        ];
        writer
            .write_event(Event::Empty(elem_with_attrs("elevation", &attrs)))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("elevationProfile".to_string())))
        .map_err(w_err)?;

    Ok(())
}

// ── Lanes ────────────────────────────────────────────

fn write_lanes(writer: &mut Writer<W>, sections: &[LaneSection]) -> Result<(), OpenDriveError> {
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

    // Link
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

    // Width
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

    // RoadMark
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

// ── Junction ─────────────────────────────────────────

fn write_junction(writer: &mut Writer<W>, junction: &Junction) -> Result<(), OpenDriveError> {
    let attrs = [("name", junction.name.clone()), ("id", junction.id.clone())];
    writer
        .write_event(Event::Start(elem_with_attrs("junction", &attrs)))
        .map_err(w_err)?;

    for conn in &junction.connections {
        let cp_str = match conn.contact_point {
            ContactPoint::Start => "start",
            ContactPoint::End => "end",
        };
        let conn_attrs = [
            ("id", conn.id.clone()),
            ("incomingRoad", conn.incoming_road.clone()),
            ("connectingRoad", conn.connecting_road.clone()),
            ("contactPoint", cp_str.to_string()),
        ];
        let ce = elem_with_attrs("connection", &conn_attrs);

        if conn.lane_links.is_empty() {
            writer.write_event(Event::Empty(ce)).map_err(w_err)?;
        } else {
            writer.write_event(Event::Start(ce)).map_err(w_err)?;

            for ll in &conn.lane_links {
                let ll_attrs = [("from", ll.from.to_string()), ("to", ll.to.to_string())];
                writer
                    .write_event(Event::Empty(elem_with_attrs("laneLink", &ll_attrs)))
                    .map_err(w_err)?;
            }

            writer
                .write_event(Event::End(BytesEnd::new("connection".to_string())))
                .map_err(w_err)?;
        }
    }

    writer
        .write_event(Event::End(BytesEnd::new("junction".to_string())))
        .map_err(w_err)?;

    Ok(())
}
