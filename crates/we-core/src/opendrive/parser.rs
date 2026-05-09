//! OpenDRIVE XML parser using quick-xml.
//!
//! Parses `.xodr` files into domain model types.

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::OpenDriveError;
use crate::model::road::*;
use crate::model::*;

/// Parse an OpenDRIVE XML string into a Project.
pub fn parse(xml: &str) -> Result<Project, OpenDriveError> {
    let mut reader = Reader::from_str(xml);
    let mut project = Project::default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"header" => {
                    project.header = parse_header(e, &mut reader)?;
                }
                b"road" => {
                    let road = parse_road(e, &mut reader)?;
                    project.roads.push(road);
                }
                b"junction" => {
                    let junction = parse_junction(e, &mut reader)?;
                    project.junctions.push(junction);
                }
                _ => {}
            },
            Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"header" {
                    project.header = parse_header_attrs(e)?;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(project)
}

// ── Header ───────────────────────────────────────────

fn parse_header(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Header, OpenDriveError> {
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

fn parse_header_attrs(e: &BytesStart) -> Result<Header, OpenDriveError> {
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

// ── Road ─────────────────────────────────────────────

fn parse_road(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Road, OpenDriveError> {
    let mut road = Road::new("", 0.0);

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

    Ok(road)
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

// ── Plan View ────────────────────────────────────────

fn parse_plan_view(reader: &mut Reader<&[u8]>) -> Result<Vec<Geometry>, OpenDriveError> {
    let mut geometries = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"geometry" => {
                let geo = parse_geometry(e, reader)?;
                geometries.push(geo);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"planView" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in planView".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(geometries)
}

fn parse_geometry(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<Geometry, OpenDriveError> {
    let mut geo = Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 0.0,
        geo_type: GeometryType::Line,
    };

    for attr in start.attributes().flatten() {
        match attr.key.as_ref() {
            b"s" => geo.s = parse_f64(&attr)?,
            b"x" => geo.x = parse_f64(&attr)?,
            b"y" => geo.y = parse_f64(&attr)?,
            b"hdg" => geo.hdg = parse_f64(&attr)?,
            b"length" => geo.length = parse_f64(&attr)?,
            _ => {}
        }
    }

    // Read the geometry type child element
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                geo.geo_type = parse_geometry_type(e)?;
                // If it was a Start event, skip to its end
                if matches!(reader.read_event(), Ok(Event::End(_))) {
                    // consumed the closing tag
                }
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"geometry" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in geometry".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(geo)
}

fn parse_geometry_type(e: &BytesStart) -> Result<GeometryType, OpenDriveError> {
    match e.name().as_ref() {
        b"line" => Ok(GeometryType::Line),
        b"arc" => {
            let mut curvature = 0.0;
            for attr in e.attributes().flatten() {
                if attr.key.as_ref() == b"curvature" {
                    curvature = parse_f64(&attr)?;
                }
            }
            Ok(GeometryType::Arc { curvature })
        }
        b"spiral" => {
            let mut curv_start = 0.0;
            let mut curv_end = 0.0;
            for attr in e.attributes().flatten() {
                match attr.key.as_ref() {
                    b"curvStart" => curv_start = parse_f64(&attr)?,
                    b"curvEnd" => curv_end = parse_f64(&attr)?,
                    _ => {}
                }
            }
            Ok(GeometryType::Spiral {
                curv_start,
                curv_end,
            })
        }
        b"poly3" => {
            let (mut a, mut b, mut c, mut d) = (0.0, 0.0, 0.0, 0.0);
            for attr in e.attributes().flatten() {
                match attr.key.as_ref() {
                    b"a" => a = parse_f64(&attr)?,
                    b"b" => b = parse_f64(&attr)?,
                    b"c" => c = parse_f64(&attr)?,
                    b"d" => d = parse_f64(&attr)?,
                    _ => {}
                }
            }
            Ok(GeometryType::Poly3 { a, b, c, d })
        }
        b"paramPoly3" | b"ParamPoly3" => {
            let (mut a_u, mut b_u, mut c_u, mut d_u) = (0.0, 0.0, 0.0, 0.0);
            let (mut a_v, mut b_v, mut c_v, mut d_v) = (0.0, 0.0, 0.0, 0.0);
            let mut p_range = ParamPoly3Range::Normalized;
            for attr in e.attributes().flatten() {
                match attr.key.as_ref() {
                    b"aU" => a_u = parse_f64(&attr)?,
                    b"bU" => b_u = parse_f64(&attr)?,
                    b"cU" => c_u = parse_f64(&attr)?,
                    b"dU" => d_u = parse_f64(&attr)?,
                    b"aV" => a_v = parse_f64(&attr)?,
                    b"bV" => b_v = parse_f64(&attr)?,
                    b"cV" => c_v = parse_f64(&attr)?,
                    b"dV" => d_v = parse_f64(&attr)?,
                    b"pRange" => {
                        p_range = match attr_str(&attr)?.as_str() {
                            "arcLength" => ParamPoly3Range::ArcLength,
                            _ => ParamPoly3Range::Normalized,
                        };
                    }
                    _ => {}
                }
            }
            Ok(GeometryType::ParamPoly3 {
                a_u,
                b_u,
                c_u,
                d_u,
                a_v,
                b_v,
                c_v,
                d_v,
                p_range,
            })
        }
        _ => Ok(GeometryType::Line), // fallback for unknown types
    }
}

// ── Elevation ────────────────────────────────────────

fn parse_elevation_profile(reader: &mut Reader<&[u8]>) -> Result<Vec<Elevation>, OpenDriveError> {
    let mut elevations = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) if e.name().as_ref() == b"elevation" => {
                elevations.push(parse_elevation_attrs(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"elevationProfile" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in elevationProfile".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(elevations)
}

fn parse_elevation_attrs(e: &BytesStart) -> Result<Elevation, OpenDriveError> {
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
    Ok(Elevation { s, a, b, c, d })
}

// ── Lanes ────────────────────────────────────────────

fn parse_lanes(reader: &mut Reader<&[u8]>) -> Result<(Vec<LaneSection>, Vec<LaneOffset>), OpenDriveError> {
    let mut sections = Vec::new();
    let mut offsets = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"laneSection" => {
                sections.push(parse_lane_section(e, reader)?);
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"laneOffset" => {
                offsets.push(parse_lane_offset(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"lanes" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in lanes".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok((sections, offsets))
}

fn parse_lane_section(
    start: &BytesStart,
    reader: &mut Reader<&[u8]>,
) -> Result<LaneSection, OpenDriveError> {
    let mut section = LaneSection {
        s: 0.0,
        single_side: false,
        left: Vec::new(),
        center: Vec::new(),
        right: Vec::new(),
    };

    for attr in start.attributes().flatten() {
        match attr.key.as_ref() {
            b"s" => section.s = parse_f64(&attr)?,
            b"singleSide" => section.single_side = attr_str(&attr)? != "0",
            _ => {}
        }
    }

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"left" => section.left = parse_lane_group(reader, b"left")?,
                b"center" => section.center = parse_lane_group(reader, b"center")?,
                b"right" => section.right = parse_lane_group(reader, b"right")?,
                _ => skip_element(reader, e.name().as_ref())?,
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"laneSection" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in laneSection".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(section)
}

fn parse_lane_group(
    reader: &mut Reader<&[u8]>,
    end_tag: &[u8],
) -> Result<Vec<Lane>, OpenDriveError> {
    let mut lanes = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"lane" => {
                lanes.push(parse_lane(e, reader)?);
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"lane" => {
                lanes.push(parse_lane_empty(e)?);
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == end_tag => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in lane group".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(lanes)
}

fn parse_lane_empty(e: &BytesStart) -> Result<Lane, OpenDriveError> {
    let mut lane = Lane {
        id: 0,
        lane_type: LaneType::None,
        level: 0,
        link: None,
        width: Vec::new(),
        borders: Vec::new(),
        road_marks: Vec::new(),
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => lane.id = attr_str(&attr)?.parse().unwrap_or(0),
            b"type" => lane.lane_type = parse_lane_type(&attr_str(&attr)?),
            b"level" => lane.level = attr_str(&attr)?.parse().unwrap_or(0),
            _ => {}
        }
    }

    Ok(lane)
}

fn parse_lane(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Lane, OpenDriveError> {
    let mut lane = parse_lane_empty(start)?;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"link" => lane.link = Some(parse_lane_link(reader)?),
                b"width" | b"roadMark" | b"border" => {
                    skip_element(reader, e.name().as_ref())?;
                }
                _ => skip_element(reader, e.name().as_ref())?,
            },
            Ok(Event::Empty(ref e)) => match e.name().as_ref() {
                b"width" => lane.width.push(parse_lane_width(e)?),
                b"roadMark" => lane.road_marks.push(parse_road_mark(e)?),
                b"border" => lane.borders.push(parse_lane_border(e)?),
                _ => {}
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"lane" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in lane".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(lane)
}

fn parse_lane_link(reader: &mut Reader<&[u8]>) -> Result<LaneLink, OpenDriveError> {
    let mut link = LaneLink {
        predecessor: None,
        successor: None,
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => match e.name().as_ref() {
                b"predecessor" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            link.predecessor = Some(attr_str(&attr)?.parse().unwrap_or(0));
                        }
                    }
                }
                b"successor" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            link.successor = Some(attr_str(&attr)?.parse().unwrap_or(0));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::End(ref e)) if e.name().as_ref() == b"link" => break,
            Ok(Event::Eof) => {
                return Err(OpenDriveError::InvalidStructure(
                    "Unexpected EOF in lane link".into(),
                ));
            }
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    Ok(link)
}

fn parse_lane_width(e: &BytesStart) -> Result<LaneWidth, OpenDriveError> {
    let (mut s_offset, mut a, mut b, mut c, mut d) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"sOffset" => s_offset = parse_f64(&attr)?,
            b"a" => a = parse_f64(&attr)?,
            b"b" => b = parse_f64(&attr)?,
            b"c" => c = parse_f64(&attr)?,
            b"d" => d = parse_f64(&attr)?,
            _ => {}
        }
    }
    Ok(LaneWidth {
        s_offset,
        a,
        b,
        c,
        d,
    })
}

fn parse_lane_border(e: &BytesStart) -> Result<LaneBorder, OpenDriveError> {
    let (mut s_offset, mut a, mut b, mut c, mut d) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"sOffset" => s_offset = parse_f64(&attr)?,
            b"a" => a = parse_f64(&attr)?,
            b"b" => b = parse_f64(&attr)?,
            b"c" => c = parse_f64(&attr)?,
            b"d" => d = parse_f64(&attr)?,
            _ => {}
        }
    }
    Ok(LaneBorder { s_offset, a, b, c, d })
}

fn parse_road_mark(e: &BytesStart) -> Result<RoadMark, OpenDriveError> {
    let mut mark = RoadMark {
        s_offset: 0.0,
        mark_type: RoadMarkType::None,
        weight: RoadMarkWeight::Standard,
        color: RoadMarkColor::Standard,
        material: String::new(),
        width: 0.0,
        lane_change: String::new(),
        height: 0.0,
    };

    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"sOffset" => mark.s_offset = parse_f64(&attr)?,
            b"type" => mark.mark_type = parse_road_mark_type(&attr_str(&attr)?),
            b"weight" => mark.weight = parse_road_mark_weight(&attr_str(&attr)?),
            b"color" => mark.color = parse_road_mark_color(&attr_str(&attr)?),
            b"material" => mark.material = attr_str(&attr)?,
            b"width" => mark.width = parse_f64(&attr)?,
            b"laneChange" => mark.lane_change = attr_str(&attr)?,
            b"height" => mark.height = parse_f64(&attr)?,
            _ => {}
        }
    }

    Ok(mark)
}

fn parse_road_mark_type(s: &str) -> RoadMarkType {
    match s {
        "solid" => RoadMarkType::Solid,
        "broken" => RoadMarkType::Broken,
        "solid broken" | "solid_broken" => RoadMarkType::SolidBroken,
        "broken solid" | "broken_solid" => RoadMarkType::BrokenSolid,
        "solid solid" | "solid_solid" => RoadMarkType::SolidSolid,
        "botts dots" | "botts_dots" => RoadMarkType::BottsDots,
        "grass" => RoadMarkType::Grass,
        "curb" => RoadMarkType::Curb,
        "stop line" | "stop_line" => RoadMarkType::StopLine,
        "custom" => RoadMarkType::Custom,
        _ => RoadMarkType::None,
    }
}

fn parse_road_mark_color(s: &str) -> RoadMarkColor {
    match s {
        "white" => RoadMarkColor::White,
        "yellow" => RoadMarkColor::Yellow,
        "red" => RoadMarkColor::Red,
        "blue" => RoadMarkColor::Blue,
        "green" => RoadMarkColor::Green,
        "orange" => RoadMarkColor::Orange,
        "violet" => RoadMarkColor::Violet,
        _ => RoadMarkColor::Standard,
    }
}

fn parse_road_mark_weight(s: &str) -> RoadMarkWeight {
    match s {
        "bold" => RoadMarkWeight::Bold,
        _ => RoadMarkWeight::Standard,
    }
}

fn parse_lane_type(s: &str) -> LaneType {
    match s.to_lowercase().as_str() {
        "driving" => LaneType::Driving,
        "shoulder" => LaneType::Shoulder,
        "sidewalk" => LaneType::Sidewalk,
        "border" => LaneType::Border,
        "parking" => LaneType::Parking,
        "median" => LaneType::Median,
        "curb" => LaneType::Curb,
        "stop" => LaneType::Stop,
        "biking" => LaneType::Biking,
        "restricted" => LaneType::Restricted,
        "bidirectional" => LaneType::Bidirectional,
        "rail" => LaneType::Rail,
        "tram" => LaneType::Tram,
        "bus" => LaneType::Bus,
        "taxi" => LaneType::Taxi,
        "hov" => LaneType::HOV,
        "entry" => LaneType::Entry,
        "exit" => LaneType::Exit,
        "offramp" | "off_ramp" => LaneType::OffRamp,
        "onramp" | "on_ramp" => LaneType::OnRamp,
        "connectingramp" | "connecting_ramp" => LaneType::ConnectingRamp,
        "special1" => LaneType::Special1,
        "special2" => LaneType::Special2,
        "special3" => LaneType::Special3,
        "roadworks" | "road_works" => LaneType::RoadWorks,
        _ => LaneType::None,
    }
}

// ── Junction ─────────────────────────────────────────

fn parse_junction(
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

// ── Lane Offset ─────────────────────────────────────

fn parse_lane_offset(e: &BytesStart) -> Result<LaneOffset, OpenDriveError> {
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
    Ok(LaneOffset { s, a, b, c, d })
}

// ── Lateral Profile ─────────────────────────────────

fn parse_lateral_profile(reader: &mut Reader<&[u8]>) -> Result<LateralProfile, OpenDriveError> {
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

fn parse_bridge_empty(e: &BytesStart) -> Result<Bridge, OpenDriveError> {
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

fn parse_bridge(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Bridge, OpenDriveError> {
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

fn parse_tunnel_empty(e: &BytesStart) -> Result<Tunnel, OpenDriveError> {
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

fn parse_tunnel(start: &BytesStart, reader: &mut Reader<&[u8]>) -> Result<Tunnel, OpenDriveError> {
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

// ── Utilities ────────────────────────────────────────

fn attr_str(attr: &quick_xml::events::attributes::Attribute) -> Result<String, OpenDriveError> {
    Ok(String::from_utf8_lossy(&attr.value).into_owned())
}

fn parse_f64(attr: &quick_xml::events::attributes::Attribute) -> Result<f64, OpenDriveError> {
    let s = String::from_utf8_lossy(&attr.value);
    s.parse::<f64>().map_err(|_| {
        OpenDriveError::InvalidStructure(format!(
            "Invalid float value '{}' for attribute '{}'",
            s,
            String::from_utf8_lossy(attr.key.as_ref())
        ))
    })
}

fn skip_element(reader: &mut Reader<&[u8]>, name: &[u8]) -> Result<(), OpenDriveError> {
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
