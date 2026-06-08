//! Road-level commands: CRUD, properties, transform, infrastructure.

mod crud;
mod infrastructure;
mod properties;
mod transform;

pub use crud::*;
pub use infrastructure::*;
pub use properties::*;
pub use transform::*;

pub(crate) use super::find_road_mut;

#[cfg(test)]
mod tests {
    use std::f64::consts::FRAC_PI_2;

    use serde_json::to_value;
    use we_core::model::*;
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    use super::*;
    use crate::EditorError;
    use crate::editor::Command;

    fn assert_projects_equal(actual: &Project, expected: &Project) {
        assert_eq!(to_value(actual).unwrap(), to_value(expected).unwrap());
    }

    fn assert_operation_failed(result: Result<Project, EditorError>, expected: &str) {
        match result {
            Err(EditorError::OperationFailed(message)) => {
                assert!(
                    message.contains(expected),
                    "expected error containing '{expected}', got '{message}'"
                );
            }
            other => panic!("expected operation failed error, got {other:?}"),
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    fn line_geometry(x: f64, y: f64, hdg: f64, length: f64) -> Geometry {
        Geometry {
            s: 0.0,
            x,
            y,
            hdg,
            length,
            geo_type: GeometryType::Line,
        }
    }

    fn elevation(s: f64, a: f64) -> Elevation {
        Elevation {
            s,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }
    }

    fn road_link(target: &str) -> RoadLink {
        RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: target.into(),
                contact_point: Some(ContactPoint::Start),
            }),
            successor: None,
        }
    }

    fn sample_road(road_id: &str) -> Road {
        let mut road = Road::from_centerline(road_id, vec![line_geometry(1.0, 2.0, 0.0, 10.0)]);
        road.name = "Old Road".into();
        road.elevation_profile = vec![elevation(0.0, 1.0)];
        road.link = Some(road_link("road-prev"));
        road
    }

    fn project_with_road() -> Project {
        Project {
            roads: vec![sample_road("road-1")],
            ..Default::default()
        }
    }

    fn straight_spline() -> EditableSpline {
        EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
        ])
    }

    #[test]
    fn test_add_road_execute_adds_road() {
        let original = Project::default();
        let command = AddRoad::new(sample_road("road-1"));

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads.len(), 1);
        assert_eq!(result.roads[0].id, "road-1");
    }

    #[test]
    fn test_add_road_undo_restores_original_project() {
        let original = Project::default();
        let command = AddRoad::new(sample_road("road-1"));
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_road_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = AddRoad::new(sample_road("road-1"));

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_add_roads_execute_adds_all() {
        let original = Project::default();
        let command = AddRoads::new(vec![sample_road("r-1"), sample_road("r-2")]);

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads.len(), 2);
    }

    #[test]
    fn test_add_roads_undo_restores_original() {
        let original = project_with_road();
        let command = AddRoads::new(vec![sample_road("r-1"), sample_road("r-2")]);
        let modified = command.execute(&original).unwrap();
        assert_eq!(modified.roads.len(), 3);

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_roads_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = AddRoads::new(vec![sample_road("road-1")]);

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_add_roads_custom_label() {
        let command = AddRoads::with_label(vec![], "Vectorize Point Cloud");
        assert_eq!(command.description(), "Vectorize Point Cloud");
    }

    #[test]
    fn test_delete_road_execute_removes_road() {
        let original = project_with_road();
        let command = DeleteRoad::with_snapshot("road-1", original.roads[0].clone());

        let result = command.execute(&original).unwrap();

        assert!(result.roads.is_empty());
    }

    #[test]
    fn test_delete_road_undo_restores_original_project() {
        let original = project_with_road();
        let command = DeleteRoad::with_snapshot("road-1", original.roads[0].clone());
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_delete_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = DeleteRoad::new("missing-road");

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_road_name_execute_renames_road() {
        let original = project_with_road();
        let command = UpdateRoadName::new("road-1", "Old Road", "Renamed Road");

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].name, "Renamed Road");
    }

    #[test]
    fn test_update_road_name_undo_restores_original_project() {
        let original = project_with_road();
        let command = UpdateRoadName::new("road-1", "Old Road", "Renamed Road");
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_update_road_name_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = UpdateRoadName::new("missing-road", "Old Road", "Renamed Road");

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_set_road_geometry_execute_replaces_plan_view() {
        let original = project_with_road();
        let command = SetRoadGeometry::new(
            "road-1",
            original.roads[0].plan_view.clone(),
            vec![
                line_geometry(5.0, 6.0, 0.25, 7.5),
                Geometry {
                    s: 7.5,
                    x: 12.5,
                    y: 6.0,
                    hdg: 0.25,
                    length: 2.5,
                    geo_type: GeometryType::Line,
                },
            ],
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].plan_view.len(), 2);
        assert_close(result.roads[0].length, 10.0);
        assert_close(result.roads[0].plan_view[0].x, 5.0);
    }

    #[test]
    fn test_set_road_geometry_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadGeometry::new(
            "road-1",
            original.roads[0].plan_view.clone(),
            vec![line_geometry(5.0, 6.0, 0.25, 7.5)],
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_geometry_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadGeometry::new(
            "missing-road",
            vec![],
            vec![line_geometry(0.0, 0.0, 0.0, 5.0)],
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_create_road_from_centerline_execute_creates_default_lanes() {
        let original = Project::default();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);

        let result = command.execute(&original).unwrap();
        let road = &result.roads[0];

        assert_eq!(result.roads.len(), 1);
        assert_close(road.length, 15.0);
        assert_eq!(road.lane_sections.len(), 1);
        assert_eq!(road.lane_sections[0].left.len(), 1);
        assert_eq!(road.lane_sections[0].right.len(), 1);
    }

    #[test]
    fn test_create_road_from_centerline_undo_restores_original_project() {
        let original = Project::default();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_create_road_from_centerline_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_create_road_from_spline_execute_creates_template_lanes() {
        let original = Project::default();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::dual_two_lane(),
            SplineOutputMode::Classify,
        );

        let result = command.execute(&original).unwrap();
        let road = &result.roads[0];

        assert_eq!(result.roads.len(), 1);
        assert!(!road.plan_view.is_empty());
        assert_eq!(road.lane_sections[0].left.len(), 2);
        assert_eq!(road.lane_sections[0].right.len(), 2);
    }

    #[test]
    fn test_create_road_from_spline_undo_restores_original_project() {
        let original = Project::default();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::single_lane(),
            SplineOutputMode::Classify,
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_create_road_from_spline_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::single_lane(),
            SplineOutputMode::Classify,
        );

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_set_road_elevation_execute_replaces_profile() {
        let original = project_with_road();
        let command = SetRoadElevation::new(
            "road-1",
            original.roads[0].elevation_profile.clone(),
            vec![elevation(0.0, 5.0), elevation(10.0, 7.0)],
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].elevation_profile.len(), 2);
        assert_close(result.roads[0].elevation_profile[0].a, 5.0);
        assert_close(result.roads[0].elevation_profile[1].a, 7.0);
    }

    #[test]
    fn test_set_road_elevation_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadElevation::new(
            "road-1",
            original.roads[0].elevation_profile.clone(),
            vec![elevation(0.0, 5.0)],
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_elevation_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadElevation::new("missing-road", vec![], vec![elevation(0.0, 5.0)]);

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_set_road_link_execute_updates_link() {
        let original = project_with_road();
        let command = SetRoadLink::new(
            "road-1",
            original.roads[0].link.clone(),
            Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "road-prev-2".into(),
                    contact_point: Some(ContactPoint::End),
                }),
                successor: Some(LinkElement {
                    element_type: LinkElementType::Junction,
                    element_id: "junction-1".into(),
                    contact_point: Some(ContactPoint::Start),
                }),
            }),
        );

        let result = command.execute(&original).unwrap();
        let link = result.roads[0].link.as_ref().unwrap();

        assert_eq!(link.successor.as_ref().unwrap().element_id, "junction-1");
    }

    #[test]
    fn test_set_road_link_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadLink::new(
            "road-1",
            original.roads[0].link.clone(),
            Some(RoadLink {
                predecessor: None,
                successor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "road-next".into(),
                    contact_point: Some(ContactPoint::Start),
                }),
            }),
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_link_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadLink::new("missing-road", None, Some(road_link("road-next")));

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_translate_road_execute_moves_geometry_and_elevation() {
        let original = project_with_road();
        let command = TranslateRoad::new("road-1", 3.0, -4.0, 2.0);

        let result = command.execute(&original).unwrap();

        assert_close(result.roads[0].plan_view[0].x, 4.0);
        assert_close(result.roads[0].plan_view[0].y, -2.0);
        assert_close(result.roads[0].elevation_profile[0].a, 3.0);
    }

    #[test]
    fn test_translate_road_undo_restores_original_project() {
        let original = project_with_road();
        let command = TranslateRoad::new("road-1", 3.0, -4.0, 2.0);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_translate_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = TranslateRoad::new("missing-road", 1.0, 2.0, 3.0);

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_rotate_road_execute_rotates_geometry() {
        let mut road = Road::from_centerline("road-1", vec![line_geometry(1.0, 0.0, 0.0, 10.0)]);
        road.name = "Rotate Me".into();
        let project = Project {
            roads: vec![road],
            ..Default::default()
        };
        let command = RotateRoad::new("road-1", [0.0, 0.0], FRAC_PI_2);

        let result = command.execute(&project).unwrap();
        let geometry = &result.roads[0].plan_view[0];

        assert!(geometry.x.abs() < 1e-9);
        assert_close(geometry.y, 1.0);
        assert_close(geometry.hdg, FRAC_PI_2);
    }

    #[test]
    fn test_rotate_road_undo_restores_original_state() {
        let original = Project {
            roads: vec![Road::from_centerline(
                "road-1",
                vec![line_geometry(1.0, 0.0, 0.0, 10.0)],
            )],
            ..Default::default()
        };
        let command = RotateRoad::new("road-1", [0.0, 0.0], FRAC_PI_2);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();
        let geometry = &undone.roads[0].plan_view[0];

        assert_close(geometry.x, 1.0);
        assert!(geometry.y.abs() < 1e-9);
        assert_close(geometry.hdg, 0.0);
    }

    #[test]
    fn test_rotate_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = RotateRoad::new("missing-road", [0.0, 0.0], FRAC_PI_2);

        assert_operation_failed(command.execute(&project), "not found");
    }

    // ── Bridge / Tunnel command tests ──────────────────────────────────────

    fn project_with_bridge() -> Project {
        let mut road = sample_road("road-1");
        road.bridges.push(we_core::model::Bridge {
            id: "bridge-1".into(),
            s: 1.0,
            length: 5.0,
            bridge_type: "concrete".into(),
        });
        Project {
            roads: vec![road],
            ..Default::default()
        }
    }

    fn project_with_tunnel() -> Project {
        let mut road = sample_road("road-1");
        road.tunnels.push(we_core::model::Tunnel {
            id: "tunnel-1".into(),
            s: 2.0,
            length: 8.0,
            tunnel_type: "standard".into(),
        });
        Project {
            roads: vec![road],
            ..Default::default()
        }
    }

    #[test]
    fn test_update_bridge_execute_changes_fields() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );

        let result = command.execute(&project).unwrap();

        let bridge = &result.roads[0].bridges[0];
        assert_close(bridge.s, 3.0);
        assert_close(bridge.length, 10.0);
        assert_eq!(bridge.bridge_type, "steel");
    }

    #[test]
    fn test_update_bridge_undo_restores_original_fields() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );
        let modified = command.execute(&project).unwrap();

        let undone = command.undo(&modified).unwrap();

        let bridge = &undone.roads[0].bridges[0];
        assert_close(bridge.s, 1.0);
        assert_close(bridge.length, 5.0);
        assert_eq!(bridge.bridge_type, "concrete");
    }

    #[test]
    fn test_update_bridge_execute_missing_road_returns_error() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "missing", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_bridge_execute_missing_bridge_returns_error() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1",
            "no-such-bridge",
            1.0,
            5.0,
            "concrete",
            3.0,
            10.0,
            "steel",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_delete_bridge_execute_removes_bridge() {
        let project = project_with_bridge();
        assert_eq!(project.roads[0].bridges.len(), 1);

        let command =
            DeleteBridge::with_snapshot("road-1", "bridge-1", project.roads[0].bridges[0].clone());
        let result = command.execute(&project).unwrap();

        assert_eq!(result.roads[0].bridges.len(), 0);
    }

    #[test]
    fn test_delete_bridge_undo_restores_bridge() {
        let project = project_with_bridge();
        let command =
            DeleteBridge::with_snapshot("road-1", "bridge-1", project.roads[0].bridges[0].clone());
        let modified = command.execute(&project).unwrap();
        assert_eq!(modified.roads[0].bridges.len(), 0);

        let undone = command.undo(&modified).unwrap();

        assert_eq!(undone.roads[0].bridges.len(), 1);
        assert_eq!(undone.roads[0].bridges[0].id, "bridge-1");
    }

    #[test]
    fn test_update_tunnel_execute_changes_fields() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "road-1",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );

        let result = command.execute(&project).unwrap();

        let tunnel = &result.roads[0].tunnels[0];
        assert_close(tunnel.s, 4.0);
        assert_close(tunnel.length, 12.0);
        assert_eq!(tunnel.tunnel_type, "underpass");
    }

    #[test]
    fn test_update_tunnel_undo_restores_original_fields() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "road-1",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );
        let modified = command.execute(&project).unwrap();

        let undone = command.undo(&modified).unwrap();

        let tunnel = &undone.roads[0].tunnels[0];
        assert_close(tunnel.s, 2.0);
        assert_close(tunnel.length, 8.0);
        assert_eq!(tunnel.tunnel_type, "standard");
    }

    #[test]
    fn test_update_tunnel_execute_missing_road_returns_error() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "missing",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_delete_tunnel_execute_removes_tunnel() {
        let project = project_with_tunnel();
        assert_eq!(project.roads[0].tunnels.len(), 1);

        let command =
            DeleteTunnel::with_snapshot("road-1", "tunnel-1", project.roads[0].tunnels[0].clone());
        let result = command.execute(&project).unwrap();

        assert_eq!(result.roads[0].tunnels.len(), 0);
    }

    #[test]
    fn test_delete_tunnel_undo_restores_tunnel() {
        let project = project_with_tunnel();
        let command =
            DeleteTunnel::with_snapshot("road-1", "tunnel-1", project.roads[0].tunnels[0].clone());
        let modified = command.execute(&project).unwrap();
        assert_eq!(modified.roads[0].tunnels.len(), 0);

        let undone = command.undo(&modified).unwrap();

        assert_eq!(undone.roads[0].tunnels.len(), 1);
        assert_eq!(undone.roads[0].tunnels[0].id, "tunnel-1");
    }
}
