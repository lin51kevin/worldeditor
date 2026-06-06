//! Transform commands: translate and rotate roads.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── TranslateRoad ────────────────────────────────────

/// Translate (move) a road's geometry by a displacement vector.
///
/// Shifts all geometry segment origins and updates elevation accordingly.
#[derive(Debug, Clone)]
pub struct TranslateRoad {
    pub road_id: String,
    pub dx: f64,
    pub dy: f64,
    pub dz: f64,
}

impl TranslateRoad {
    pub fn new(road_id: impl Into<String>, dx: f64, dy: f64, dz: f64) -> Self {
        Self {
            road_id: road_id.into(),
            dx,
            dy,
            dz,
        }
    }
}

impl Command for TranslateRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        for geo in &mut road.plan_view {
            geo.x += self.dx;
            geo.y += self.dy;
        }
        if self.dz.abs() > 1e-12 {
            if road.elevation_profile.is_empty() {
                road.elevation_profile.push(Elevation {
                    s: 0.0,
                    a: self.dz,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                });
            } else {
                for ep in &mut road.elevation_profile {
                    ep.a += self.dz;
                }
            }
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        for geo in &mut road.plan_view {
            geo.x -= self.dx;
            geo.y -= self.dy;
        }
        if self.dz.abs() > 1e-12 {
            for ep in &mut road.elevation_profile {
                ep.a -= self.dz;
            }
            road.elevation_profile.retain(|ep| {
                ep.a.abs() > 1e-12 || ep.b.abs() > 1e-12 || ep.c.abs() > 1e-12 || ep.d.abs() > 1e-12
            });
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Translate Road"
    }
}

// ── RotateRoad ───────────────────────────────────────

/// Rotate a road's geometry around a pivot point.
///
/// `angle_rad` is the rotation angle in radians (counter-clockwise positive).
/// `pivot` is the (x, y) rotation center.
#[derive(Debug, Clone)]
pub struct RotateRoad {
    pub road_id: String,
    pub pivot: [f64; 2],
    pub angle_rad: f64,
}

impl RotateRoad {
    pub fn new(road_id: impl Into<String>, pivot: [f64; 2], angle_rad: f64) -> Self {
        Self {
            road_id: road_id.into(),
            pivot,
            angle_rad,
        }
    }
}

fn rotate_point_2d(x: f64, y: f64, cx: f64, cy: f64, angle: f64) -> (f64, f64) {
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    let dx = x - cx;
    let dy = y - cy;
    (cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a)
}

impl Command for RotateRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let [cx, cy] = self.pivot;
        for geo in &mut road.plan_view {
            let (nx, ny) = rotate_point_2d(geo.x, geo.y, cx, cy, self.angle_rad);
            geo.x = nx;
            geo.y = ny;
            geo.hdg += self.angle_rad;
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let [cx, cy] = self.pivot;
        for geo in &mut road.plan_view {
            let (nx, ny) = rotate_point_2d(geo.x, geo.y, cx, cy, -self.angle_rad);
            geo.x = nx;
            geo.y = ny;
            geo.hdg -= self.angle_rad;
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Rotate Road"
    }
}
