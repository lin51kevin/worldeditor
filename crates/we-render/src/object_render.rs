//! Road object rendering — signs, barriers, guardrails, etc.
//!
//! Renders road objects as simple 3D geometry (boxes, cylinders, etc.)
//! based on OpenDRIVE object definitions.

use crate::vertex::ColorVertex;
use we_core::model::{ObjectType, Point3D, RoadObject};

/// Default colors for different object types.
fn object_color(obj_type: &ObjectType) -> [f32; 4] {
    match obj_type {
        ObjectType::Sign => [0.9, 0.9, 0.9, 1.0], // White/gray for signs
        ObjectType::Guardrail => [0.5, 0.5, 0.5, 1.0], // Metal gray
        ObjectType::Barrier => [0.8, 0.6, 0.2, 1.0], // Orange/yellow for barriers
        ObjectType::Curb => [0.6, 0.6, 0.55, 1.0], // Concrete
        ObjectType::Wall => [0.4, 0.4, 0.4, 1.0], // Dark gray
        ObjectType::Pillar => [0.5, 0.5, 0.5, 1.0], // Metal
        ObjectType::TrafficCone => [0.9, 0.5, 0.1, 1.0], // Orange
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
            width: 1.0,
            height: 1.0,
            validity: None,
        }];
        let vertices = generate_object_render_data(&objects);
        assert!(!vertices.is_empty());
    }
}
