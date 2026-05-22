//! MapInfo MIF import/export.

use thiserror::Error;
use we_core::model::{Geometry, GeometryType, Project, Road};

#[derive(Error, Debug)]
pub enum MifError {
    #[error("Invalid MIF structure: {0}")]
    Invalid(String),
}

/// Import roads from a MapInfo MIF text string.
///
/// Currently supports `LINE` and `PLINE` records and converts them into
/// road centerlines composed of straight geometries.
pub fn import_from_mif(mif: &str) -> Result<Project, MifError> {
    if mif.trim().is_empty() {
        return Err(MifError::Invalid("empty MIF input".into()));
    }

    let lines: Vec<&str> = mif
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();

    let data_index = lines
        .iter()
        .position(|line| line.eq_ignore_ascii_case("data"))
        .ok_or_else(|| MifError::Invalid("missing DATA section".into()))?;

    let mut roads = Vec::new();
    let mut line_index = data_index + 1;

    while line_index < lines.len() {
        let record = lines[line_index];
        if record.eq_ignore_ascii_case("none") {
            line_index += 1;
            continue;
        }

        let upper = record.to_ascii_uppercase();
        if upper.starts_with("LINE ") {
            roads.push(parse_line_record(record, roads.len() + 1)?);
            line_index += 1;
            continue;
        }

        if upper.starts_with("PLINE ") {
            let point_count = parse_point_count(record)?;
            let next_index = line_index + 1 + point_count;
            if next_index > lines.len() {
                return Err(MifError::Invalid(format!(
                    "PLINE declares {point_count} points but file ended early"
                )));
            }
            let points = lines[(line_index + 1)..next_index]
                .iter()
                .map(|line| parse_point(line))
                .collect::<Result<Vec<_>, _>>()?;
            roads.push(build_road_from_points(
                format!("mif_{}", roads.len() + 1),
                &points,
            )?);
            line_index = next_index;
            continue;
        }

        line_index += 1;
    }

    if roads.is_empty() {
        return Err(MifError::Invalid(
            "no supported LINE/PLINE geometry found".into(),
        ));
    }

    Ok(Project {
        name: "MIF Import".into(),
        roads,
        ..Default::default()
    })
}

/// Export a project as a MapInfo MIF text string.
pub fn export_to_mif(project: &Project) -> Result<String, MifError> {
    let mut out = String::from(
        "Version 300\nCharset \"Neutral\"\nDelimiter \",\"\nCoordSys NonEarth Units \"m\"\nColumns 0\nData\n",
    );

    for road in &project.roads {
        let points = road_points(road);
        if points.len() < 2 {
            continue;
        }

        out.push_str(&format!("PLINE {}\n", points.len()));
        for (x, y) in points {
            out.push_str(&format!("{} {}\n", format_coord(x), format_coord(y)));
        }
    }

    Ok(out)
}

fn parse_line_record(record: &str, index: usize) -> Result<Road, MifError> {
    let payload = record
        .split_once(char::is_whitespace)
        .map(|(_, rest)| rest.trim())
        .ok_or_else(|| MifError::Invalid(format!("invalid LINE record: {record}")))?;
    let coords = parse_f64_tokens(payload, 4)?;
    build_road_from_points(
        format!("mif_{index}"),
        &[(coords[0], coords[1]), (coords[2], coords[3])],
    )
}

fn parse_point_count(record: &str) -> Result<usize, MifError> {
    let mut parts = record.split_whitespace();
    let keyword = parts.next().unwrap_or_default();
    if !keyword.eq_ignore_ascii_case("PLINE") {
        return Err(MifError::Invalid(format!("unsupported record: {record}")));
    }

    let count = parts
        .next()
        .ok_or_else(|| MifError::Invalid(format!("missing PLINE point count: {record}")))?
        .parse::<usize>()
        .map_err(|e| MifError::Invalid(format!("invalid PLINE point count: {e}")))?;

    if count < 2 {
        return Err(MifError::Invalid(format!(
            "PLINE must contain at least 2 points, got {count}"
        )));
    }

    Ok(count)
}

fn parse_point(line: &str) -> Result<(f64, f64), MifError> {
    let coords = parse_f64_tokens(line, 2)?;
    Ok((coords[0], coords[1]))
}

fn parse_f64_tokens(line: &str, expected: usize) -> Result<Vec<f64>, MifError> {
    let values = line
        .split_whitespace()
        .map(|token| {
            token
                .parse::<f64>()
                .map_err(|e| MifError::Invalid(format!("invalid numeric token '{token}': {e}")))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if values.len() != expected {
        return Err(MifError::Invalid(format!(
            "expected exactly {expected} numeric values in '{line}'"
        )));
    }

    Ok(values)
}

fn build_road_from_points(id: String, points: &[(f64, f64)]) -> Result<Road, MifError> {
    if points.len() < 2 {
        return Err(MifError::Invalid("road requires at least 2 points".into()));
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
        return Err(MifError::Invalid(
            "road geometry collapsed to zero-length segments".into(),
        ));
    }

    Ok(Road::from_centerline(id, geometries))
}

fn road_points(road: &Road) -> Vec<(f64, f64)> {
    let mut points = Vec::new();
    for (index, geo) in road.plan_view.iter().enumerate() {
        if index == 0 {
            points.push((geo.x, geo.y));
        }
        let end_x = geo.x + geo.length * geo.hdg.cos();
        let end_y = geo.y + geo.length * geo.hdg.sin();
        points.push((end_x, end_y));
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
    fn test_import_basic_pline() {
        let mif = r#"Version 300
Charset "Neutral"
Delimiter ","
CoordSys NonEarth Units "m"
Columns 0
Data
PLINE 3
0 0
10 0
10 5
"#;

        let project = import_from_mif(mif).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert_eq!(project.roads[0].plan_view.len(), 2);
        assert!((project.roads[0].length - 15.0).abs() < 1e-6);
    }

    #[test]
    fn test_import_line_record() {
        let mif = r#"Version 300
Columns 0
Data
LINE 1 2 4 6
"#;

        let project = import_from_mif(mif).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert_eq!(project.roads[0].plan_view.len(), 1);
        assert!((project.roads[0].plan_view[0].x - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_import_requires_data_section() {
        let err = import_from_mif("Version 300\nColumns 0").unwrap_err();
        assert!(err.to_string().contains("missing DATA"));
    }

    #[test]
    fn test_export_project_to_mif() {
        let road =
            build_road_from_points("r0".into(), &[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0)]).unwrap();
        let project = Project {
            roads: vec![road],
            ..Default::default()
        };

        let mif = export_to_mif(&project).unwrap();
        assert!(mif.contains("Version 300"));
        assert!(mif.contains("PLINE 3"));
        assert!(mif.contains("5 5"));
    }

    #[test]
    fn test_round_trip_preserves_road_count() {
        let source = r#"Version 300
Columns 0
Data
PLINE 2
0 0
8 0
PLINE 2
1 1
1 6
"#;

        let project = import_from_mif(source).unwrap();
        let exported = export_to_mif(&project).unwrap();
        let reparsed = import_from_mif(&exported).unwrap();
        assert_eq!(reparsed.roads.len(), 2);
    }
}
