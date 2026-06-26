//! Map road objects into GPU-instanced batches.
//!
//! Flat ground markings (crosswalks, parking spaces, stop lines, hatch areas)
//! have per-object polygon geometry and are *not* instancing candidates — they
//! keep using the tessellated [`crate::object_render`] path.
//!
//! Repeated 3D props, however, share a single prototype mesh and differ only by
//! transform and colour. This module collects those into an
//! [`InstanceCollector`] so the renderer can draw all props of one prototype
//! kind with a single instanced draw call, turning `O(N × verts)` vertex upload
//! into `O(prototype_verts + N × instance_data)`.

use we_core::geometry::eval::{RefLinePoint, evaluate_elevation, evaluate_geometry, offset_point};
use we_core::model::{Geometry, ObjectType, Project, RoadObject};

use crate::instance_render::InstanceCollector;
use crate::object_render::object_color;

/// Which instanced prototype, if any, represents a given object type.
enum PropPrototype {
    /// Vertical post — poles, pillars, cones, signs, gantries.
    Pole,
    /// Box wall segment stretched along the road — guardrails, barriers, walls.
    Wall,
}

/// Classify a road object into an instanced prototype.
///
/// Returns `None` for flat markings and area objects, which are rendered as
/// tessellated polygons rather than instanced props.
fn classify(object_type: &ObjectType) -> Option<PropPrototype> {
    use ObjectType::*;
    match object_type {
        TrafficCone | Pillar | Sign | SimpleSignalPole | TrafficLightPole | StreetLightPole
        | SignGantry | LTypeSignalPole => Some(PropPrototype::Pole),
        Guardrail | Barrier | Wall => Some(PropPrototype::Wall),
        // Flat markings / areas — handled by object_render tessellation.
        Curb | ParkingSpace | Crosswalk | StopLine | CrossHatchArea | WovenArea
        | ForwardWaitingArea | TurnLeftWaitingArea | SlowDownToYieldLine | StopToYieldLine
        | Custom(_) => None,
    }
}

/// Default horizontal radius (metres) for a pole-like prop.
fn pole_radius(object_type: &ObjectType, obj: &RoadObject) -> f32 {
    if obj.width > 0.0 {
        (obj.width as f32 * 0.5).clamp(0.05, 1.0)
    } else {
        match object_type {
            ObjectType::TrafficCone => 0.25,
            ObjectType::SignGantry => 0.3,
            _ => 0.15,
        }
    }
}

/// Default vertical height (metres) for a pole-like prop.
fn pole_height(object_type: &ObjectType, obj: &RoadObject) -> f32 {
    if obj.height > 0.0 {
        obj.height as f32
    } else {
        match object_type {
            ObjectType::TrafficCone => 0.7,
            ObjectType::SignGantry => 6.0,
            ObjectType::Sign => 2.0,
            _ => 3.5,
        }
    }
}

/// Default `(height, lateral_thickness)` for a wall-like prop.
fn wall_dims(object_type: &ObjectType, obj: &RoadObject) -> (f32, f32) {
    let height = if obj.height > 0.0 {
        obj.height as f32
    } else {
        match object_type {
            ObjectType::Barrier => 0.9,
            ObjectType::Wall => 2.0,
            _ => 0.8, // guardrail
        }
    };
    (height, 0.15)
}

/// Evaluate the road reference line at station `s`, extrapolating beyond the
/// final geometry segment along its end tangent (mirrors the object renderer so
/// props placed slightly past the road end stay consistent with their markings).
fn road_point_at_s(plan_view: &[Geometry], s: f64) -> Option<RefLinePoint> {
    if plan_view.is_empty() {
        return None;
    }
    let geo = plan_view
        .iter()
        .rev()
        .find(|g| g.s <= s + 1e-9)
        .unwrap_or(&plan_view[0]);

    let ds = s - geo.s;
    if ds <= geo.length + 1e-9 {
        let ds_clamped = ds.clamp(0.0, geo.length);
        Some(evaluate_geometry(geo, ds_clamped))
    } else {
        let end_pt = evaluate_geometry(geo, geo.length);
        let overshoot = ds - geo.length;
        Some(RefLinePoint {
            x: end_pt.x + overshoot * end_pt.hdg.cos(),
            y: end_pt.y + overshoot * end_pt.hdg.sin(),
            hdg: end_pt.hdg,
            s,
        })
    }
}

/// Collect all instanceable road-object props in `project` into batches.
///
/// Visible roads contribute their pole- and wall-like objects; hidden roads and
/// flat markings are skipped. Each prop is placed in world space from its
/// road-local `(s, t, zOffset)` position and oriented by `road_heading + obj.hdg`.
pub fn collect_road_object_instances(project: &Project) -> InstanceCollector {
    let mut collector = InstanceCollector::new();

    for road in &project.roads {
        if road.render_hidden || road.objects.is_empty() {
            continue;
        }

        for obj in &road.objects {
            let Some(prototype) = classify(&obj.object_type) else {
                continue;
            };

            let s = obj.position.x;
            let t = obj.position.y;
            // Negative-s placements are invalid (consistent with object_render).
            if s < -1.0 {
                continue;
            }

            let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
                continue;
            };

            let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
            let z_ground = evaluate_elevation(&road.elevation_profile, s) as f32
                + (obj.position.z as f32).max(0.0);
            let heading = (ref_pt.hdg + obj.hdg) as f32;
            let color = object_color(&obj.object_type);

            match prototype {
                PropPrototype::Pole => {
                    let radius = pole_radius(&obj.object_type, obj);
                    let height = pole_height(&obj.object_type, obj);
                    collector.add_pole(
                        wx as f32, wy as f32, z_ground, heading, radius, height, color,
                    );
                }
                PropPrototype::Wall => {
                    let length = if obj.length > 0.0 {
                        obj.length as f32
                    } else {
                        5.0
                    };
                    let (height, thickness) = wall_dims(&obj.object_type, obj);
                    // add_box centres the prototype, so lift it by half its height.
                    collector.add_box(
                        wx as f32,
                        wy as f32,
                        z_ground + height * 0.5,
                        heading,
                        length,
                        height,
                        thickness,
                        color,
                    );
                }
            }
        }
    }

    collector
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance_render::PrototypeKind;
    use we_core::model::{Geometry, GeometryType, Project, Road};

    /// Build a straight road of `length` along +X starting at the origin.
    fn straight_road(id: &str, length: f64) -> Road {
        Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length,
                geo_type: GeometryType::Line,
            }],
        )
    }

    /// Deserialize a single road object from a compact JSON literal.
    fn object(json: &str) -> RoadObject {
        serde_json::from_str(json).expect("valid road object json")
    }

    fn project_with(road: Road) -> Project {
        let mut p = Project::default();
        p.roads.push(road);
        p
    }

    #[test]
    fn skips_flat_marking_objects() {
        let mut road = straight_road("r1", 50.0);
        road.objects.push(object(
            r#"{"id":"o1","type":"crosswalk","position":{"x":10,"y":0,"z":0},"validity":null}"#,
        ));
        road.objects.push(object(
            r#"{"id":"o2","type":"parkingSpace","position":{"x":20,"y":0,"z":0},"validity":null}"#,
        ));

        let collector = collect_road_object_instances(&project_with(road));
        assert!(collector.is_empty());
    }

    #[test]
    fn pole_object_creates_pole_instance_in_world_space() {
        let mut road = straight_road("r1", 50.0);
        road.objects.push(object(
            r#"{"id":"o1","type":"trafficCone","position":{"x":10,"y":0,"z":0},"validity":null}"#,
        ));

        let batches = collect_road_object_instances(&project_with(road)).into_batches();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].kind, PrototypeKind::Pole);
        let inst = batches[0].instances[0];
        // Road runs along +X from origin, so s=10 → world x≈10, y≈0.
        assert!(
            (inst.model_col3[0] - 10.0).abs() < 1e-4,
            "x={}",
            inst.model_col3[0]
        );
        assert!(
            (inst.model_col3[1]).abs() < 1e-4,
            "y={}",
            inst.model_col3[1]
        );
    }

    #[test]
    fn lateral_offset_shifts_pole_off_centerline() {
        let mut road = straight_road("r1", 50.0);
        // t = +3 → 3 m to the left of a +X road (world +Y).
        road.objects.push(object(
            r#"{"id":"o1","type":"streetLightPole","position":{"x":5,"y":3,"z":0},"validity":null}"#,
        ));

        let batches = collect_road_object_instances(&project_with(road)).into_batches();
        let inst = batches[0].instances[0];
        assert!((inst.model_col3[0] - 5.0).abs() < 1e-4);
        assert!(
            (inst.model_col3[1] - 3.0).abs() < 1e-4,
            "y={}",
            inst.model_col3[1]
        );
    }

    #[test]
    fn guardrail_creates_box_instance() {
        let mut road = straight_road("r1", 50.0);
        road.objects.push(object(
            r#"{"id":"o1","type":"guardrail","position":{"x":10,"y":-2,"z":0},"length":8,"validity":null}"#,
        ));

        let batches = collect_road_object_instances(&project_with(road)).into_batches();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].kind, PrototypeKind::Box);
        let inst = batches[0].instances[0];
        // Box half-length along the road tangent = length/2 = 4.
        assert!(
            (inst.model_col0[0] - 4.0).abs() < 1e-4,
            "len-scale={}",
            inst.model_col0[0]
        );
    }

    #[test]
    fn distinct_prototypes_are_batched_separately() {
        let mut road = straight_road("r1", 50.0);
        road.objects.push(object(
            r#"{"id":"o1","type":"trafficCone","position":{"x":10,"y":0,"z":0},"validity":null}"#,
        ));
        road.objects.push(object(
            r#"{"id":"o2","type":"barrier","position":{"x":20,"y":0,"z":0},"length":6,"validity":null}"#,
        ));

        let collector = collect_road_object_instances(&project_with(road));
        assert_eq!(collector.total_instances(), 2);
        assert_eq!(collector.into_batches().len(), 2); // Pole + Box
    }

    #[test]
    fn hidden_road_contributes_no_instances() {
        let mut road = straight_road("r1", 50.0);
        road.render_hidden = true;
        road.objects.push(object(
            r#"{"id":"o1","type":"trafficCone","position":{"x":10,"y":0,"z":0},"validity":null}"#,
        ));

        assert!(collect_road_object_instances(&project_with(road)).is_empty());
    }

    #[test]
    fn negative_s_object_is_skipped() {
        let mut road = straight_road("r1", 50.0);
        road.objects.push(object(
            r#"{"id":"o1","type":"trafficCone","position":{"x":-5,"y":0,"z":0},"validity":null}"#,
        ));

        assert!(collect_road_object_instances(&project_with(road)).is_empty());
    }
}
