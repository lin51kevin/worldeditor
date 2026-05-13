use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64, skip_element};
use crate::model::*;

pub(super) fn parse_lanes(reader: &mut Reader<&[u8]>) -> Result<(Vec<LaneSection>, Vec<LaneOffset>), OpenDriveError> {
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
        render_hidden: false,
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
        render_hidden: false,
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
                // When roadMark/width/border have child elements (Start event),
                // parse their attributes from the opening tag then skip the children.
                b"width" => {
                    lane.width.push(parse_lane_width(e)?);
                    skip_element(reader, b"width")?;
                }
                b"roadMark" => {
                    lane.road_marks.push(parse_road_mark(e)?);
                    skip_element(reader, b"roadMark")?;
                }
                b"border" => {
                    lane.borders.push(parse_lane_border(e)?);
                    skip_element(reader, b"border")?;
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
