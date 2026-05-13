use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::super::OpenDriveError;
use super::utils::{attr_str, parse_f64};
use crate::model::*;

pub(super) fn parse_plan_view(reader: &mut Reader<&[u8]>) -> Result<Vec<Geometry>, OpenDriveError> {
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

pub(super) fn parse_elevation_profile(reader: &mut Reader<&[u8]>) -> Result<Vec<Elevation>, OpenDriveError> {
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
