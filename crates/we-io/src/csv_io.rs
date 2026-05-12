//! CSV coordinate import/export for road network data.
//!
//! Supports importing road centre-lines from CSV files with
//! columns for X, Y (world coordinates) and optional heading/ID.
//! Each row produces one road with a single straight geometry.

use thiserror::Error;
use we_core::model::{Geometry, GeometryType, Project, Road};

#[derive(Error, Debug)]
pub enum CsvError {
    #[error("CSV parse error on line {line}: {message}")]
    ParseError { line: usize, message: String },
    #[error("Empty CSV input")]
    EmptyInput,
}

/// Options controlling how CSV data is interpreted.
#[derive(Debug, Clone)]
pub struct CsvImportOptions {
    /// Column delimiter character (default: ',')
    pub delimiter: char,
    /// Whether the first row contains column headers (default: true)
    pub has_header: bool,
    /// 0-based column index for X coordinate
    pub x_col: usize,
    /// 0-based column index for Y coordinate
    pub y_col: usize,
    /// 0-based column index for heading (optional)
    pub hdg_col: Option<usize>,
    /// 0-based column index for road ID (optional)
    pub id_col: Option<usize>,
}

impl Default for CsvImportOptions {
    fn default() -> Self {
        Self {
            delimiter: ',',
            has_header: true,
            x_col: 0,
            y_col: 1,
            hdg_col: Some(2),
            id_col: None,
        }
    }
}

/// Parse CSV content into a list of roads (one road per row).
///
/// Each CSV row produces a road with:
/// - 10 m default length
/// - A single straight-line geometry from (x, y) at `hdg`
/// - One forward driving lane section (via [`Road::from_centerline`])
pub fn import_roads_from_csv(csv: &str, opts: &CsvImportOptions) -> Result<Vec<Road>, CsvError> {
    let mut lines = csv.lines().enumerate().peekable();
    if lines.peek().is_none() {
        return Err(CsvError::EmptyInput);
    }

    // Skip header row
    if opts.has_header {
        lines.next();
    }

    let mut roads = Vec::new();
    let mut id_counter = 0u32;

    for (line_idx, line) in lines {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let cols: Vec<&str> = line.split(opts.delimiter).collect();

        let x = parse_col(&cols, opts.x_col, line_idx + 1, "x")?;
        let y = parse_col(&cols, opts.y_col, line_idx + 1, "y")?;
        let hdg = opts
            .hdg_col
            .and_then(|c| cols.get(c))
            .and_then(|s| s.trim().parse::<f64>().ok())
            .unwrap_or(0.0);

        id_counter += 1;
        let road_id = opts
            .id_col
            .and_then(|c| cols.get(c))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| format!("csv_{id_counter}"));

        let geom = Geometry {
            s: 0.0,
            x,
            y,
            hdg,
            length: 10.0,
            geo_type: GeometryType::Line,
        };
        let road = Road::from_centerline(road_id, vec![geom]);
        roads.push(road);
    }
    Ok(roads)
}

fn parse_col(cols: &[&str], idx: usize, line: usize, name: &str) -> Result<f64, CsvError> {
    cols.get(idx)
        .ok_or_else(|| CsvError::ParseError {
            line,
            message: format!("column {idx} ({name}) out of range"),
        })?
        .trim()
        .parse::<f64>()
        .map_err(|e| CsvError::ParseError {
            line,
            message: format!("column {idx} ({name}): {e}"),
        })
}

/// Export the road centre-lines of a project as CSV text.
///
/// Columns: `id,x,y,hdg,length`
pub fn export_roads_to_csv(project: &Project) -> String {
    let mut out = String::from("id,x,y,hdg,length\n");
    for road in &project.roads {
        if let Some(first) = road.plan_view.first() {
            out.push_str(&format!(
                "{},{},{},{},{}\n",
                road.id, first.x, first.y, first.hdg, road.length
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_basic_csv() {
        let csv = "x,y,hdg\n10.0,20.0,0.5\n30.0,40.0,1.0\n";
        let roads = import_roads_from_csv(csv, &CsvImportOptions::default()).unwrap();
        assert_eq!(roads.len(), 2);
        assert_eq!(roads[0].plan_view[0].x, 10.0);
        assert_eq!(roads[0].plan_view[0].y, 20.0);
        assert_eq!(roads[0].plan_view[0].hdg, 0.5);
    }

    #[test]
    fn test_import_no_header() {
        let csv = "1.0,2.0,0.0\n3.0,4.0,0.5\n";
        let opts = CsvImportOptions {
            has_header: false,
            ..Default::default()
        };
        let roads = import_roads_from_csv(csv, &opts).unwrap();
        assert_eq!(roads.len(), 2);
    }

    #[test]
    fn test_import_skips_comments_and_blank_lines() {
        let csv = "x,y\n# comment\n\n5.0,10.0\n";
        let opts = CsvImportOptions {
            hdg_col: None,
            ..Default::default()
        };
        let roads = import_roads_from_csv(csv, &opts).unwrap();
        assert_eq!(roads.len(), 1);
        assert_eq!(roads[0].plan_view[0].x, 5.0);
    }

    #[test]
    fn test_import_custom_delimiter() {
        let csv = "x;y;hdg\n1.0;2.0;0.0\n";
        let opts = CsvImportOptions {
            delimiter: ';',
            ..Default::default()
        };
        let roads = import_roads_from_csv(csv, &opts).unwrap();
        assert_eq!(roads.len(), 1);
        assert_eq!(roads[0].plan_view[0].x, 1.0);
    }

    #[test]
    fn test_import_empty_csv_returns_error() {
        let result = import_roads_from_csv("", &CsvImportOptions::default());
        assert!(matches!(result, Err(CsvError::EmptyInput)));
    }

    #[test]
    fn test_import_bad_number_returns_parse_error() {
        let csv = "x,y\nnotanumber,2.0\n";
        let result = import_roads_from_csv(csv, &CsvImportOptions::default());
        assert!(matches!(result, Err(CsvError::ParseError { .. })));
    }

    #[test]
    fn test_export_empty_project() {
        let project = Project::default();
        let csv = export_roads_to_csv(&project);
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines.len(), 1); // header only
        assert_eq!(lines[0], "id,x,y,hdg,length");
    }

    #[test]
    fn test_export_road_values() {
        let geom = Geometry { s: 0.0, x: 5.0, y: 3.0, hdg: 0.0, length: 20.0, geo_type: GeometryType::Line };
        let road = Road::from_centerline("r0", vec![geom]);
        let project = Project { roads: vec![road], ..Default::default() };
        let csv = export_roads_to_csv(&project);
        let row = csv.lines().nth(1).unwrap();
        assert!(row.contains("r0"));
        assert!(row.contains('5'));
    }

    #[test]
    fn test_export_header_row() {
        let geom = Geometry { s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 10.0, geo_type: GeometryType::Line };
        let road = Road::from_centerline("r1", vec![geom]);
        let project = Project { roads: vec![road], ..Default::default() };
        let csv = export_roads_to_csv(&project);
        assert!(csv.starts_with("id,x,y,hdg,length"));
    }

    #[test]
    fn test_import_auto_generates_ids() {
        let csv = "x,y\n1.0,2.0\n3.0,4.0\n";
        let opts = CsvImportOptions {
            hdg_col: None,
            id_col: None,
            ..Default::default()
        };
        let roads = import_roads_from_csv(csv, &opts).unwrap();
        assert!(roads[0].id.starts_with("csv_"));
        assert!(roads[1].id.starts_with("csv_"));
        assert_ne!(roads[0].id, roads[1].id);
    }

    #[test]
    fn test_import_with_explicit_id_column() {
        let csv = "id,x,y\nroad_1,1.0,2.0\n";
        let opts = CsvImportOptions {
            id_col: Some(0),
            x_col: 1,
            y_col: 2,
            hdg_col: None,
            ..Default::default()
        };
        let roads = import_roads_from_csv(csv, &opts).unwrap();
        assert_eq!(roads[0].id, "road_1");
    }
}
