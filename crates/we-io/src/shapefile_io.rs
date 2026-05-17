//! Shapefile single-file bundle import/export.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use we_core::model::{Geometry, GeometryType, Project, Road};

const MAGIC: &[u8] = b"WESHP1\0";

#[derive(Debug, Serialize, Deserialize)]
struct ShapefileBundle {
    roads: Vec<ShapefileRoad>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ShapefileRoad {
    id: String,
    name: String,
    points: Vec<[f64; 2]>,
}

#[derive(Error, Debug)]
pub enum ShapefileError {
    #[error("Invalid shapefile bundle header")]
    InvalidHeader,
    #[error("Invalid shapefile bundle: {0}")]
    Invalid(String),
}

/// Import roads from raw shapefile bytes.
pub fn import_from_shapefile(shp_bytes: &[u8]) -> Result<Project, ShapefileError> {
    if shp_bytes.len() < MAGIC.len() || &shp_bytes[..MAGIC.len()] != MAGIC {
        return Err(ShapefileError::InvalidHeader);
    }

    let bundle: ShapefileBundle = serde_json::from_slice(&shp_bytes[MAGIC.len()..])
        .map_err(|e| ShapefileError::Invalid(e.to_string()))?;

    let roads = bundle
        .roads
        .into_iter()
        .map(import_road)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Project {
        name: "Shapefile Import".into(),
        roads,
        ..Default::default()
    })
}

/// Export a project to shapefile bytes.
pub fn export_to_shapefile(project: &Project) -> Result<Vec<u8>, ShapefileError> {
    let bundle = ShapefileBundle {
        roads: project.roads.iter().map(export_road).collect(),
    };
    let mut bytes = MAGIC.to_vec();
    bytes.extend(
        serde_json::to_vec(&bundle).map_err(|e| ShapefileError::Invalid(e.to_string()))?,
    );
    Ok(bytes)
}

fn import_road(road: ShapefileRoad) -> Result<Road, ShapefileError> {
    if road.points.len() < 2 {
        return Err(ShapefileError::Invalid(format!(
            "road '{}' requires at least 2 points",
            road.id
        )));
    }

    let mut geometries = Vec::new();
    let mut s = 0.0;
    for pair in road.points.windows(2) {
        let [x0, y0] = pair[0];
        let [x1, y1] = pair[1];
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
        return Err(ShapefileError::Invalid(format!(
            "road '{}' collapsed to zero-length geometry",
            road.id
        )));
    }

    let mut imported = Road::from_centerline(road.id, geometries);
    imported.name = road.name;
    Ok(imported)
}

fn export_road(road: &Road) -> ShapefileRoad {
    let mut points = Vec::new();
    for (index, geometry) in road.plan_view.iter().enumerate() {
        if index == 0 {
            points.push([geometry.x, geometry.y]);
        }
        points.push([
            geometry.x + geometry.length * geometry.hdg.cos(),
            geometry.y + geometry.length * geometry.hdg.sin(),
        ]);
    }

    ShapefileRoad {
        id: road.id.clone(),
        name: road.name.clone(),
        points,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType};

    #[test]
    fn test_import_requires_magic_header() {
        assert!(matches!(import_from_shapefile(&[]), Err(ShapefileError::InvalidHeader)));
    }

    #[test]
    fn test_export_and_import_round_trip() {
        let road = Road::from_centerline(
            "road_1",
            vec![
                Geometry {
                    s: 0.0,
                    x: 0.0,
                    y: 0.0,
                    hdg: 0.0,
                    length: 10.0,
                    geo_type: GeometryType::Line,
                },
                Geometry {
                    s: 10.0,
                    x: 10.0,
                    y: 0.0,
                    hdg: std::f64::consts::FRAC_PI_2,
                    length: 5.0,
                    geo_type: GeometryType::Line,
                },
            ],
        );
        let project = Project {
            roads: vec![road],
            ..Default::default()
        };

        let bytes = export_to_shapefile(&project).unwrap();
        assert_eq!(&bytes[..MAGIC.len()], MAGIC);

        let imported = import_from_shapefile(&bytes).unwrap();
        assert_eq!(imported.roads.len(), 1);
        assert_eq!(imported.roads[0].plan_view.len(), 2);
    }

    #[test]
    fn test_error_display() {
        assert!(ShapefileError::InvalidHeader.to_string().contains("header"));
    }
}
