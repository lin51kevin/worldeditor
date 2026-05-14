//! Road object rendering — signs, barriers, guardrails, etc.
//!
//! Renders road objects as simple 3D geometry (boxes, cylinders, etc.)
//! based on OpenDRIVE object definitions.

use crate::vertex::ColorVertex;
use we_core::model::{ObjectType, Point3D, RoadObject};

/// Default colors for different object types.
fn object_color(obj_type: &ObjectType) -> [f32; 4] {
    match obj_type {
        ObjectType::Sign => [0.9, 0.9, 0.9, 1.0],
        ObjectType::Guardrail => [0.5, 0.5, 0.5, 1.0],
        ObjectType::Barrier => [0.8, 0.6, 0.2, 1.0],
        ObjectType::Curb => [0.6, 0.6, 0.55, 1.0],
        ObjectType::Wall => [0.4, 0.4, 0.4, 1.0],
        ObjectType::Pillar => [0.5, 0.5, 0.5, 1.0],
        ObjectType::TrafficCone => [0.9, 0.5, 0.1, 1.0],
        ObjectType::ParkingSpace => [0.424, 0.549, 0.278, 1.0],
        ObjectType::Crosswalk => [0.000, 0.000, 0.502, 1.0],
        ObjectType::StopLine | ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => {
            [1.0, 1.0, 1.0, 1.0]
        }
        ObjectType::CrossHatchArea => [0.965, 0.651, 0.137, 1.0],
        ObjectType::WovenArea => [1.000, 0.051, 0.651, 1.0],
        ObjectType::SlowDownToYieldLine => [0.000, 0.749, 1.000, 1.0],
        ObjectType::StopToYieldLine => [0.816, 0.008, 0.106, 1.0],
        ObjectType::SimpleSignalPole => [0.000, 1.000, 1.000, 1.0],
        ObjectType::TrafficLightPole => [0.400, 0.251, 1.000, 1.0],
        ObjectType::StreetLightPole => [0.612, 0.553, 0.839, 1.0],
        ObjectType::SignGantry => [0.071, 0.455, 0.212, 1.0],
        ObjectType::LTypeSignalPole => [0.502, 0.000, 0.000, 1.0],
        ObjectType::Custom(_) => [0.7, 0.7, 0.7, 1.0],
    }
}

/// Generate a box mesh for a road object.
pub fn generate_box_mesh(
    position: &Point3D,
    width: f64,
    height: f64,
    depth: f64,
    orientation: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut vertices = Vec::with_capacity(36); // 12 triangles * 3 vertices

    let hw = (width / 2.0) as f32;
    let hh = (height / 2.0) as f32;
    let hd = (depth / 2.0) as f32;

    let cos_h = orientation.cos() as f32;
    let sin_h = orientation.sin() as f32;

    // 8 corners of the box (before rotation)
    let corners = [
        [-hw, -hd, -hh], // 0: back-bottom-left
        [hw, -hd, -hh],  // 1: back-bottom-right
        [hw, hd, -hh],   // 2: back-top-right
        [-hw, hd, -hh],  // 3: back-top-left
        [-hw, -hd, hh],  // 4: front-bottom-left
        [hw, -hd, hh],   // 5: front-bottom-right
        [hw, hd, hh],    // 6: front-top-right
        [-hw, hd, hh],   // 7: front-top-left
    ];

    let center_x = position.x as f32;
    let center_y = position.y as f32;
    let center_z = position.z as f32;

    // Transform corner with rotation around Z
    let rotate = |x: f32, y: f32| -> (f32, f32) {
        let rx = x * cos_h - y * sin_h;
        let ry = x * sin_h + y * cos_h;
        (rx, ry)
    };

    let transformed: Vec<[f32; 3]> = corners
        .iter()
        .map(|c| {
            let (rx, ry) = rotate(c[0], c[1]);
            [center_x + rx, center_y + ry, center_z + c[2]]
        })
        .collect();

    // Faces with their vertex indices (CCW winding)
    let faces = [
        // Back face
        ([0, 1, 2], [0, 2, 3]),
        // Front face
        ([4, 6, 5], [4, 7, 6]),
        // Left face
        ([0, 3, 7], [0, 7, 4]),
        // Right face
        ([1, 5, 6], [1, 6, 2]),
        // Top face
        ([3, 2, 6], [3, 6, 7]),
        // Bottom face
        ([0, 4, 5], [0, 5, 1]),
    ];

    for (tri1, tri2) in faces {
        for idx in tri1.iter() {
            vertices.push(ColorVertex::new(transformed[*idx], color));
        }
        for idx in tri2.iter() {
            vertices.push(ColorVertex::new(transformed[*idx], color));
        }
    }

    vertices
}

/// Generate a sign post (vertical pole with sign board).
pub fn generate_sign_post(
    position: &Point3D,
    orientation: f64,
    pole_height: f64,
    sign_width: f64,
    sign_height: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    // Generate the pole (thin vertical cylinder approximated as box)
    let pole_color = [0.3, 0.3, 0.3, 1.0]; // Dark gray pole
    vertices.extend(generate_box_mesh(
        &Point3D::new(position.x, position.y, position.z + pole_height / 2.0),
        0.1, // pole width
        pole_height,
        0.1, // pole depth
        orientation,
        pole_color,
    ));

    // Generate the sign board
    vertices.extend(generate_box_mesh(
        &Point3D::new(
            position.x,
            position.y,
            position.z + pole_height + sign_height / 2.0,
        ),
        sign_width,
        sign_height,
        0.05, // thin board
        orientation,
        color,
    ));

    vertices
}

/// Generate render data for all objects on a road.
pub fn generate_object_render_data(objects: &[RoadObject]) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    for obj in objects {
        let color = object_color(&obj.object_type);

        match &obj.object_type {
            ObjectType::Sign => {
                // Signs have a pole and board
                vertices.extend(generate_sign_post(
                    &obj.position,
                    obj.orientation,
                    3.0, // default pole height
                    obj.width,
                    obj.height,
                    color,
                ));
            }
            ObjectType::Guardrail => {
                // Guardrails are long horizontal barriers
                vertices.extend(generate_box_mesh(
                    &obj.position,
                    0.2, // thin rail
                    0.8, // rail height
                    obj.width,
                    obj.orientation,
                    color,
                ));
            }
            ObjectType::Barrier => {
                // Barriers are wider protective barriers
                vertices.extend(generate_box_mesh(
                    &obj.position,
                    obj.width,
                    obj.height,
                    0.3, // depth
                    obj.orientation,
                    color,
                ));
            }
            ObjectType::Curb => {
                // Curbs are low raised barriers
                vertices.extend(generate_box_mesh(
                    &obj.position,
                    obj.width,
                    obj.height.min(0.3),
                    0.3,
                    obj.orientation,
                    color,
                ));
            }
            ObjectType::TrafficCone => {
                // Traffic cones are small triangular objects
                vertices.extend(generate_box_mesh(
                    &obj.position,
                    obj.width.min(0.3),
                    obj.height.max(0.5),
                    obj.width.min(0.3),
                    obj.orientation,
                    color,
                ));
            }
            _ => {
                // Default: box with specified dimensions
                vertices.extend(generate_box_mesh(
                    &obj.position,
                    obj.width,
                    obj.height,
                    0.1, // default depth
                    obj.orientation,
                    color,
                ));
            }
        }
    }

    vertices
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::CornerType;

    #[test]
    fn test_box_mesh_generation() {
        let position = Point3D::new(0.0, 0.0, 0.0);
        let vertices = generate_box_mesh(&position, 1.0, 2.0, 1.0, 0.0, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(vertices.len(), 36); // 12 triangles * 3 vertices
    }

    #[test]
    fn test_sign_post_generation() {
        let position = Point3D::new(10.0, 5.0, 0.0);
        let vertices = generate_sign_post(&position, 0.0, 3.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
        assert!(!vertices.is_empty());
    }

    #[test]
    fn test_object_render_data() {
        let objects = vec![RoadObject {
            id: "1".to_string(),
            object_type: ObjectType::Sign,
            name: "Stop".to_string(),
            position: Point3D::new(0.0, 0.0, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 1.0,
            height: 1.0,
            length: 0.0,
            corners: vec![],
            corner_type: CornerType::Local,
            validity: None,
            from_object_ref: false,
        }];
        let vertices = generate_object_render_data(&objects);
        assert!(!vertices.is_empty());
    }

    fn make_obj(t: ObjectType) -> RoadObject {
        RoadObject {
            id: "x".into(),
            object_type: t,
            name: "n".into(),
            position: Point3D::new(1.0, 2.0, 0.5),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 1.0,
            height: 1.0,
            length: 0.0,
            corners: vec![],
            corner_type: CornerType::Local,
            validity: None,
            from_object_ref: false,
        }
    }

    #[test]
    fn test_object_color_branches() {
        // Each variant returns a distinct rgba color
        assert_eq!(object_color(&ObjectType::Sign), [0.9, 0.9, 0.9, 1.0]);
        assert_eq!(object_color(&ObjectType::Guardrail), [0.5, 0.5, 0.5, 1.0]);
        assert_eq!(object_color(&ObjectType::Barrier), [0.8, 0.6, 0.2, 1.0]);
        assert_eq!(object_color(&ObjectType::Curb), [0.6, 0.6, 0.55, 1.0]);
        assert_eq!(object_color(&ObjectType::Wall), [0.4, 0.4, 0.4, 1.0]);
        assert_eq!(object_color(&ObjectType::Pillar), [0.5, 0.5, 0.5, 1.0]);
        assert_eq!(object_color(&ObjectType::TrafficCone), [0.9, 0.5, 0.1, 1.0]);
        assert_eq!(
            object_color(&ObjectType::Custom("foo".into())),
            [0.7, 0.7, 0.7, 1.0]
        );
    }

    #[test]
    fn test_box_mesh_zero_dimensions_still_emits_vertices() {
        let p = Point3D::new(0.0, 0.0, 0.0);
        let v = generate_box_mesh(&p, 0.0, 0.0, 0.0, 0.0, [0.0; 4]);
        assert_eq!(v.len(), 36);
    }

    #[test]
    fn test_box_mesh_translated_to_position() {
        let p = Point3D::new(10.0, -5.0, 2.0);
        let v = generate_box_mesh(&p, 0.0, 0.0, 0.0, 0.0, [0.0; 4]);
        // All 36 vertices should equal the position when dimensions are zero
        for vert in &v {
            assert!((vert.position[0] - 10.0).abs() < 1e-5);
            assert!((vert.position[1] - (-5.0)).abs() < 1e-5);
            assert!((vert.position[2] - 2.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_box_mesh_rotation_changes_xy_only() {
        let p = Point3D::new(0.0, 0.0, 0.0);
        let v0 = generate_box_mesh(&p, 1.0, 1.0, 1.0, 0.0, [0.0; 4]);
        let v90 = generate_box_mesh(&p, 1.0, 1.0, 1.0, std::f64::consts::FRAC_PI_2, [0.0; 4]);
        // Z coordinates must be the same (rotation is around Z)
        for (a, b) in v0.iter().zip(v90.iter()) {
            assert!((a.position[2] - b.position[2]).abs() < 1e-5);
        }
        // But XY should differ
        let differs = v0.iter().zip(v90.iter()).any(|(a, b)| {
            (a.position[0] - b.position[0]).abs() > 1e-3
                || (a.position[1] - b.position[1]).abs() > 1e-3
        });
        assert!(differs);
    }

    #[test]
    fn test_sign_post_emits_pole_plus_board() {
        let p = Point3D::new(0.0, 0.0, 0.0);
        let v = generate_sign_post(&p, 0.0, 3.0, 1.0, 1.0, [1.0; 4]);
        assert_eq!(v.len(), 72); // two boxes
    }

    #[test]
    fn test_render_data_empty_input_empty_output() {
        let v = generate_object_render_data(&[]);
        assert!(v.is_empty());
    }

    #[test]
    fn test_render_data_each_object_type() {
        for t in [
            ObjectType::Sign,
            ObjectType::Guardrail,
            ObjectType::Barrier,
            ObjectType::Curb,
            ObjectType::Wall,
            ObjectType::Pillar,
            ObjectType::TrafficCone,
            ObjectType::Custom("x".into()),
        ] {
            let v = generate_object_render_data(&[make_obj(t.clone())]);
            assert!(!v.is_empty(), "type {:?} produced no vertices", t);
        }
    }

    #[test]
    fn test_render_data_sign_emits_more_than_box() {
        // Sign uses pole + board (2 boxes); other types use 1 box
        let sign = generate_object_render_data(&[make_obj(ObjectType::Sign)]);
        let wall = generate_object_render_data(&[make_obj(ObjectType::Wall)]);
        assert!(sign.len() > wall.len());
    }

    #[test]
    fn test_render_data_aggregates_all_objects() {
        let objs = vec![
            make_obj(ObjectType::Wall),
            make_obj(ObjectType::Barrier),
            make_obj(ObjectType::Pillar),
        ];
        let v = generate_object_render_data(&objs);
        // 3 boxes * 36 vertices each
        assert_eq!(v.len(), 36 * 3);
    }

    #[test]
    fn test_render_data_curb_height_clamped() {
        // Curb height is min(height, 0.3) — verify a tall curb doesn't break
        let mut o = make_obj(ObjectType::Curb);
        o.height = 5.0;
        let v = generate_object_render_data(&[o]);
        assert_eq!(v.len(), 36);
    }

    #[test]
    fn test_render_data_traffic_cone_sizes_clamped() {
        let mut o = make_obj(ObjectType::TrafficCone);
        o.width = 10.0;
        o.height = 0.1;
        let v = generate_object_render_data(&[o]);
        assert_eq!(v.len(), 36);
    }
}
