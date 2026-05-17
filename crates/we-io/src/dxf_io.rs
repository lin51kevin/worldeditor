//! DXF CAD format import/export.

use thiserror::Error;
use we_core::model::{Geometry, GeometryType, Project, Road};

#[derive(Error, Debug)]
pub enum DxfError {
    #[error("Invalid DXF structure: {0}")]
    Invalid(String),
}

/// Import roads from a DXF text string.
pub fn import_from_dxf(dxf: &str) -> Result<Project, DxfError> {
    if dxf.trim().is_empty() {
        return Err(DxfError::Invalid("empty dxf input".into()));
    }

    let pairs = parse_pairs(dxf)?;
    let mut roads = Vec::new();
    let mut index = 0usize;
    let mut road_counter = 0usize;

    while index < pairs.len() {
        let (code, value) = &pairs[index];
        if code == "0" && value == "LINE" {
            roads.push(parse_line_entity(&pairs, &mut index, road_counter + 1)?);
            road_counter += 1;
            continue;
        }

        if code == "0" && value == "LWPOLYLINE" {
            roads.push(parse_lwpolyline_entity(&pairs, &mut index, road_counter + 1)?);
            road_counter += 1;
            continue;
        }

        index += 1;
    }

    if roads.is_empty() {
        return Err(DxfError::Invalid(
            "no LINE or LWPOLYLINE entities found".into(),
        ));
    }

    Ok(Project {
        name: "DXF Import".into(),
        roads,
        ..Default::default()
    })
}

/// Export a project as DXF text.
pub fn export_to_dxf(project: &Project) -> Result<String, DxfError> {
    let mut out = String::from("0\nSECTION\n2\nENTITIES\n");

    for road in &project.roads {
        let points = road_points(road);
        if points.len() < 2 {
            continue;
        }

        if points.len() == 2 {
            out.push_str("0\nLINE\n8\nROADS\n");
            out.push_str(&format!(
                "10\n{}\n20\n{}\n11\n{}\n21\n{}\n",
                format_coord(points[0].0),
                format_coord(points[0].1),
                format_coord(points[1].0),
                format_coord(points[1].1)
            ));
        } else {
            out.push_str("0\nLWPOLYLINE\n8\nROADS\n");
            out.push_str(&format!("90\n{}\n", points.len()));
            for (x, y) in points {
                out.push_str(&format!("10\n{}\n20\n{}\n", format_coord(x), format_coord(y)));
            }
        }
    }

    out.push_str("0\nENDSEC\n0\nEOF\n");
    Ok(out)
}

fn parse_pairs(dxf: &str) -> Result<Vec<(String, String)>, DxfError> {
    let lines = dxf.lines().map(str::trim).collect::<Vec<_>>();
    if lines.len() % 2 != 0 {
        return Err(DxfError::Invalid("group code/value pairs are incomplete".into()));
    }

    Ok(lines
        .chunks(2)
        .map(|chunk| (chunk[0].to_string(), chunk[1].to_string()))
        .collect())
}

fn parse_line_entity(
    pairs: &[(String, String)],
    index: &mut usize,
    road_index: usize,
) -> Result<Road, DxfError> {
    let mut x0 = None;
    let mut y0 = None;
    let mut x1 = None;
    let mut y1 = None;
    *index += 1;

    while *index < pairs.len() {
        let (code, value) = &pairs[*index];
        if code == "0" {
            break;
        }

        match code.as_str() {
            "10" => x0 = Some(parse_num(value)?),
            "20" => y0 = Some(parse_num(value)?),
            "11" => x1 = Some(parse_num(value)?),
            "21" => y1 = Some(parse_num(value)?),
            _ => {}
        }
        *index += 1;
    }

    build_road_from_points(
        format!("dxf_{road_index}"),
        &[(x0.ok_or_else(|| DxfError::Invalid("LINE missing start x".into()))?, y0.ok_or_else(|| DxfError::Invalid("LINE missing start y".into()))?),
          (x1.ok_or_else(|| DxfError::Invalid("LINE missing end x".into()))?, y1.ok_or_else(|| DxfError::Invalid("LINE missing end y".into()))?)],
    )
}

fn parse_lwpolyline_entity(
    pairs: &[(String, String)],
    index: &mut usize,
    road_index: usize,
) -> Result<Road, DxfError> {
    let mut points = Vec::new();
    let mut pending_x: Option<f64> = None;
    *index += 1;

    while *index < pairs.len() {
        let (code, value) = &pairs[*index];
        if code == "0" {
            break;
        }

        match code.as_str() {
            "10" => pending_x = Some(parse_num(value)?),
            "20" => {
                if let Some(x) = pending_x.take() {
                    points.push((x, parse_num(value)?));
                }
            }
            _ => {}
        }
        *index += 1;
    }

    build_road_from_points(format!("dxf_{road_index}"), &points)
}

fn parse_num(value: &str) -> Result<f64, DxfError> {
    let parsed = value
        .parse::<f64>()
        .map_err(|e| DxfError::Invalid(format!("invalid numeric value '{value}': {e}")))?;
    if !parsed.is_finite() {
        return Err(DxfError::Invalid(format!(
            "numeric value '{value}' must be finite"
        )));
    }
    Ok(parsed)
}

fn build_road_from_points(id: String, points: &[(f64, f64)]) -> Result<Road, DxfError> {
    if points.len() < 2 {
        return Err(DxfError::Invalid("entity requires at least 2 points".into()));
    }

    let mut s = 0.0;
    let mut geometries = Vec::new();
    for pair in points.windows(2) {
        let (x0, y0) = pair[0];
        let (x1, y1) = pair[1];
        let dx = x1 - x0;
        let dy = y1 - y0;
        let length = (dx * dx + dy * dy).sqrt();
        if length <= f64::EPSILON {
            continue;
        }
        geometries.push(Geometry {
            s,
            x: x0,
            y: y0,
            hdg: dy.atan2(dx),
            length,
            geo_type: GeometryType::Line,
        });
        s += length;
    }

    if geometries.is_empty() {
        return Err(DxfError::Invalid("entity collapsed to zero-length geometry".into()));
    }

    Ok(Road::from_centerline(id, geometries))
}

fn road_points(road: &Road) -> Vec<(f64, f64)> {
    let mut points = Vec::new();
    for (index, geometry) in road.plan_view.iter().enumerate() {
        if index == 0 {
            points.push((geometry.x, geometry.y));
        }
        points.push((
            geometry.x + geometry.length * geometry.hdg.cos(),
            geometry.y + geometry.length * geometry.hdg.sin(),
        ));
    }
    points
}

fn format_coord(value: f64) -> String {
    if value.fract().abs() <= f64::EPSILON {
        format!("{value:.0}")
    } else {
        format!("{value:.6}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_line_entity() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n1\n20\n2\n11\n4\n21\n6\n0\nENDSEC\n0\nEOF\n";
        let project = import_from_dxf(dxf).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert_eq!(project.roads[0].plan_view.len(), 1);
    }

    #[test]
    fn test_import_lwpolyline_entity() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n3\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n5\n0\nENDSEC\n0\nEOF\n";
        let project = import_from_dxf(dxf).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert_eq!(project.roads[0].plan_view.len(), 2);
    }

    #[test]
    fn test_export_line_entity() {
        let road = Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 20.0,
                geo_type: GeometryType::Line,
            }],
        );
        let dxf = export_to_dxf(&Project {
            roads: vec![road],
            ..Default::default()
        })
        .unwrap();
        assert!(dxf.contains("LINE"));
        assert!(dxf.contains("11\n20"));
    }

    #[test]
    fn test_round_trip_road_count() {
        let source = "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n5\n21\n0\n0\nLWPOLYLINE\n90\n2\n10\n1\n20\n1\n10\n1\n20\n4\n0\nENDSEC\n0\nEOF\n";
        let project = import_from_dxf(source).unwrap();
        let exported = export_to_dxf(&project).unwrap();
        let reparsed = import_from_dxf(&exported).unwrap();
        assert_eq!(reparsed.roads.len(), 2);
    }

    #[test]
    fn test_import_rejects_non_finite_values() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nNaN\n20\n0\n11\n5\n21\n0\n0\nENDSEC\n0\nEOF\n";
        assert!(matches!(
            import_from_dxf(dxf),
            Err(DxfError::Invalid(message)) if message.contains("finite")
        ));
    }
}
