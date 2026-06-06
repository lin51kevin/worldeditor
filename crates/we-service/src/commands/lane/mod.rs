//! Lane commands: CRUD, property updates, section operations, and profile.

mod crud;
mod profile;
mod properties;
mod section_ops;

pub use crud::*;
pub use profile::*;
pub use properties::*;
pub use section_ops::*;

pub(crate) use super::find_lane_mut;
pub(crate) use super::find_road_mut;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::Command;
    use we_core::model::*;

    fn make_geometry(length: f64) -> Geometry {
        Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length,
            geo_type: GeometryType::Line,
        }
    }

    fn make_lane_width(a: f64) -> LaneWidth {
        LaneWidth {
            s_offset: 0.0,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }
    }

    fn make_lane(id: i32, lane_type: LaneType) -> Lane {
        Lane {
            id,
            lane_type,
            level: 0,
            render_hidden: false,
            link: None,
            width: if id == 0 {
                vec![]
            } else {
                vec![make_lane_width(3.5)]
            },
            borders: vec![],
            road_marks: vec![],
        }
    }

    fn make_lane_section(s: f64) -> LaneSection {
        LaneSection {
            s,
            single_side: false,
            render_hidden: false,
            left: vec![make_lane(1, LaneType::Driving)],
            center: vec![make_lane(0, LaneType::None)],
            right: vec![make_lane(-1, LaneType::Driving)],
        }
    }

    fn make_project(section_starts: &[f64], length: f64) -> Project {
        let mut road = Road::from_centerline("road-1", vec![make_geometry(length)]);
        road.lane_sections = section_starts
            .iter()
            .copied()
            .map(make_lane_section)
            .collect();
        Project {
            roads: vec![road],
            ..Project::default()
        }
    }

    fn find_section(project: &Project, section_s: f64) -> &LaneSection {
        project.roads[0]
            .lane_sections
            .iter()
            .find(|section| (section.s - section_s).abs() < 1e-9)
            .expect("lane section with matching s must exist in test fixture")
    }

    fn find_lane(project: &Project, section_s: f64, lane_id: i32) -> &Lane {
        let section = find_section(project, section_s);
        if lane_id > 0 {
            section
                .left
                .iter()
                .find(|lane| lane.id == lane_id)
                .expect("lane with matching id must exist in test fixture")
        } else if lane_id < 0 {
            section
                .right
                .iter()
                .find(|lane| lane.id == lane_id)
                .expect("lane with matching id must exist in test fixture")
        } else {
            section
                .center
                .iter()
                .find(|lane| lane.id == lane_id)
                .expect("lane with matching id must exist in test fixture")
        }
    }

    fn make_road_mark(mark_type: RoadMarkType) -> RoadMark {
        RoadMark {
            s_offset: 0.0,
            mark_type,
            weight: RoadMarkWeight::Standard,
            color: RoadMarkColor::White,
            material: "standard".into(),
            width: 0.15,
            lane_change: "none".into(),
            height: 0.02,
        }
    }

    #[test]
    fn test_add_lane_section_execute_adds_section() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLaneSection::new("road-1", make_lane_section(50.0));

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        let section_starts: Vec<f64> = result.roads[0]
            .lane_sections
            .iter()
            .map(|section| section.s)
            .collect();
        assert_eq!(section_starts, vec![0.0, 50.0]);
    }

    #[test]
    fn test_add_lane_section_undo_removes_added_section() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLaneSection::new("road-1", make_lane_section(50.0));

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert_eq!(undone.roads[0].lane_sections.len(), 1);
        assert!((undone.roads[0].lane_sections[0].s - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_add_lane_section_execute_missing_road_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLaneSection::new("missing-road", make_lane_section(50.0));

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_add_lane_execute_adds_lane_to_left_side() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLane::new(
            "road-1",
            0.0,
            LaneSide::Left,
            make_lane(2, LaneType::Shoulder),
        );

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        let section = find_section(&result, 0.0);
        assert_eq!(section.left.len(), 2);
        assert!(section.left.iter().any(|lane| lane.id == 2));
    }

    #[test]
    fn test_add_lane_undo_removes_added_lane() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLane::new(
            "road-1",
            0.0,
            LaneSide::Left,
            make_lane(2, LaneType::Shoulder),
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        let section = find_section(&undone, 0.0);
        assert_eq!(section.left.len(), 1);
        assert!(section.left.iter().all(|lane| lane.id != 2));
    }

    #[test]
    fn test_add_lane_execute_missing_section_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = AddLane::new(
            "road-1",
            25.0,
            LaneSide::Left,
            make_lane(2, LaneType::Shoulder),
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_lane_execute_removes_lane() {
        let project = make_project(&[0.0], 100.0);
        let snapshot = find_lane(&project, 0.0, 1).clone();
        let cmd = DeleteLane::with_snapshot("road-1", 0.0, 1, snapshot);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert!(find_section(&result, 0.0).left.is_empty());
    }

    #[test]
    fn test_delete_lane_undo_restores_lane() {
        let project = make_project(&[0.0], 100.0);
        let snapshot = find_lane(&project, 0.0, 1).clone();
        let cmd = DeleteLane::with_snapshot("road-1", 0.0, 1, snapshot);

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert_eq!(find_section(&undone, 0.0).left.len(), 1);
        assert_eq!(find_lane(&undone, 0.0, 1).lane_type, LaneType::Driving);
    }

    #[test]
    fn test_delete_lane_execute_missing_lane_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = DeleteLane::new("road-1", 0.0, 9);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_update_lane_type_execute_changes_lane_type() {
        let project = make_project(&[0.0], 100.0);
        let cmd = UpdateLaneType::new("road-1", 0.0, 1, LaneType::Driving, LaneType::Sidewalk);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(find_lane(&result, 0.0, 1).lane_type, LaneType::Sidewalk);
    }

    #[test]
    fn test_update_lane_type_undo_restores_lane_type() {
        let project = make_project(&[0.0], 100.0);
        let cmd = UpdateLaneType::new("road-1", 0.0, 1, LaneType::Driving, LaneType::Sidewalk);

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert_eq!(find_lane(&undone, 0.0, 1).lane_type, LaneType::Driving);
    }

    #[test]
    fn test_update_lane_type_execute_missing_lane_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = UpdateLaneType::new("road-1", 0.0, 9, LaneType::Driving, LaneType::Sidewalk);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_update_lane_width_execute_replaces_width_profile() {
        let project = make_project(&[0.0], 100.0);
        let old_widths = find_lane(&project, 0.0, 1).width.clone();
        let new_widths = vec![make_lane_width(4.25)];
        let cmd = UpdateLaneWidth::new("road-1", 0.0, 1, old_widths, new_widths.clone());

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert!((find_lane(&result, 0.0, 1).width[0].a - new_widths[0].a).abs() < 1e-9);
    }

    #[test]
    fn test_update_lane_width_undo_restores_width_profile() {
        let project = make_project(&[0.0], 100.0);
        let old_widths = find_lane(&project, 0.0, 1).width.clone();
        let cmd = UpdateLaneWidth::new(
            "road-1",
            0.0,
            1,
            old_widths.clone(),
            vec![make_lane_width(4.25)],
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!((find_lane(&undone, 0.0, 1).width[0].a - old_widths[0].a).abs() < 1e-9);
    }

    #[test]
    fn test_update_lane_width_execute_missing_lane_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = UpdateLaneWidth::new(
            "road-1",
            0.0,
            9,
            vec![make_lane_width(3.5)],
            vec![make_lane_width(4.25)],
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_split_lane_section_execute_inserts_split_section() {
        let mut project = make_project(&[0.0], 100.0);
        project.roads[0].lane_sections[0].right[0].width = vec![LaneWidth {
            s_offset: 0.0,
            a: 3.5,
            b: 0.01,
            c: 0.0,
            d: 0.0,
        }];
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = SplitLaneSection::new("road-1", 0.0, 50.0, old_sections);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        let section_starts: Vec<f64> = result.roads[0]
            .lane_sections
            .iter()
            .map(|section| section.s)
            .collect();
        assert_eq!(section_starts, vec![0.0, 50.0]);
        assert!((find_lane(&result, 50.0, -1).width[0].a - 4.0).abs() < 1e-6);
    }

    #[test]
    fn test_split_lane_section_undo_restores_original_sections() {
        let project = make_project(&[0.0], 100.0);
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = SplitLaneSection::new("road-1", 0.0, 50.0, old_sections.clone());

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        let section_starts: Vec<f64> = undone.roads[0]
            .lane_sections
            .iter()
            .map(|section| section.s)
            .collect();
        let expected: Vec<f64> = old_sections.iter().map(|section| section.s).collect();
        assert_eq!(section_starts, expected);
    }

    #[test]
    fn test_split_lane_section_execute_beyond_end_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = SplitLaneSection::new("road-1", 0.0, 120.0, old_sections);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_merge_lane_sections_execute_removes_successor_section() {
        let project = make_project(&[0.0, 50.0], 100.0);
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = MergeLaneSections::new("road-1", 0.0, old_sections);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(result.roads[0].lane_sections.len(), 1);
        assert!((result.roads[0].lane_sections[0].s - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_merge_lane_sections_undo_restores_successor_section() {
        let project = make_project(&[0.0, 50.0], 100.0);
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = MergeLaneSections::new("road-1", 0.0, old_sections.clone());

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        let section_starts: Vec<f64> = undone.roads[0]
            .lane_sections
            .iter()
            .map(|section| section.s)
            .collect();
        let expected: Vec<f64> = old_sections.iter().map(|section| section.s).collect();
        assert_eq!(section_starts, expected);
    }

    #[test]
    fn test_merge_lane_sections_execute_without_successor_returns_error() {
        let project = make_project(&[0.0, 50.0], 100.0);
        let old_sections = project.roads[0].lane_sections.clone();
        let cmd = MergeLaneSections::new("road-1", 50.0, old_sections);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_lane_section_execute_removes_section() {
        let project = make_project(&[0.0, 50.0], 100.0);
        let snapshot = find_section(&project, 50.0).clone();
        let cmd = DeleteLaneSection::with_snapshot("road-1", 50.0, snapshot);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(result.roads[0].lane_sections.len(), 1);
        assert!((result.roads[0].lane_sections[0].s - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_delete_lane_section_undo_restores_section() {
        let project = make_project(&[0.0, 50.0], 100.0);
        let snapshot = find_section(&project, 50.0).clone();
        let cmd = DeleteLaneSection::with_snapshot("road-1", 50.0, snapshot);

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        let section_starts: Vec<f64> = undone.roads[0]
            .lane_sections
            .iter()
            .map(|section| section.s)
            .collect();
        assert_eq!(section_starts, vec![0.0, 50.0]);
    }

    #[test]
    fn test_delete_lane_section_execute_last_section_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = DeleteLaneSection::new("road-1", 0.0);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_lane_link_execute_updates_link() {
        let project = make_project(&[0.0], 100.0);
        let new_link = Some(LaneLink {
            predecessor: Some(0),
            successor: Some(2),
        });
        let cmd = SetLaneLink::new("road-1", 0.0, 1, None, new_link);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        let link = find_lane(&result, 0.0, 1)
            .link
            .as_ref()
            .expect("lane link must be set after execute");
        assert_eq!(link.predecessor, Some(0));
        assert_eq!(link.successor, Some(2));
    }

    #[test]
    fn test_set_lane_link_undo_restores_previous_link() {
        let project = make_project(&[0.0], 100.0);
        let new_link = Some(LaneLink {
            predecessor: Some(0),
            successor: Some(2),
        });
        let cmd = SetLaneLink::new("road-1", 0.0, 1, None, new_link);

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!(find_lane(&undone, 0.0, 1).link.is_none());
    }

    #[test]
    fn test_set_lane_link_execute_missing_lane_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetLaneLink::new(
            "road-1",
            0.0,
            9,
            None,
            Some(LaneLink {
                predecessor: Some(0),
                successor: Some(2),
            }),
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_lane_road_mark_execute_replaces_marks() {
        let project = make_project(&[0.0], 100.0);
        let new_marks = vec![make_road_mark(RoadMarkType::Solid)];
        let cmd = SetLaneRoadMark::new("road-1", 0.0, 1, vec![], new_marks);

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        let lane = find_lane(&result, 0.0, 1);
        assert_eq!(lane.road_marks.len(), 1);
        assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
    }

    #[test]
    fn test_set_lane_road_mark_undo_restores_previous_marks() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetLaneRoadMark::new(
            "road-1",
            0.0,
            1,
            vec![],
            vec![make_road_mark(RoadMarkType::Solid)],
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!(find_lane(&undone, 0.0, 1).road_marks.is_empty());
    }

    #[test]
    fn test_set_lane_road_mark_execute_missing_lane_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetLaneRoadMark::new(
            "road-1",
            0.0,
            9,
            vec![],
            vec![make_road_mark(RoadMarkType::Solid)],
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_lane_offset_execute_updates_offsets() {
        let project = make_project(&[0.0], 100.0);
        let new_offsets = vec![LaneOffset {
            s: 0.0,
            a: 0.5,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let cmd = SetLaneOffset::new("road-1", vec![], new_offsets.clone());

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(result.roads[0].lane_offsets.len(), 1);
        assert!((result.roads[0].lane_offsets[0].a - new_offsets[0].a).abs() < 1e-9);
    }

    #[test]
    fn test_set_lane_offset_undo_restores_offsets() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetLaneOffset::new(
            "road-1",
            vec![],
            vec![LaneOffset {
                s: 0.0,
                a: 0.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!(undone.roads[0].lane_offsets.is_empty());
    }

    #[test]
    fn test_set_lane_offset_execute_missing_road_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetLaneOffset::new(
            "missing-road",
            vec![],
            vec![LaneOffset {
                s: 0.0,
                a: 0.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_superelevation_execute_updates_profile() {
        let project = make_project(&[0.0], 100.0);
        let new_profile = vec![Superelevation {
            s: 0.0,
            a: 0.02,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let cmd = SetSuperelevation::new("road-1", vec![], new_profile.clone());

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(result.roads[0].lateral_profile.superelevations.len(), 1);
        assert!(
            (result.roads[0].lateral_profile.superelevations[0].a - new_profile[0].a).abs() < 1e-9
        );
    }

    #[test]
    fn test_set_superelevation_undo_restores_profile() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetSuperelevation::new(
            "road-1",
            vec![],
            vec![Superelevation {
                s: 0.0,
                a: 0.02,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!(undone.roads[0].lateral_profile.superelevations.is_empty());
    }

    #[test]
    fn test_set_superelevation_execute_missing_road_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetSuperelevation::new(
            "missing-road",
            vec![],
            vec![Superelevation {
                s: 0.0,
                a: 0.02,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_crossfall_execute_updates_profile() {
        let project = make_project(&[0.0], 100.0);
        let new_profile = vec![Crossfall {
            s: 0.0,
            a: 0.03,
            b: 0.0,
            c: 0.0,
            d: 0.0,
            side: CrossfallSide::Both,
        }];
        let cmd = SetCrossfall::new("road-1", vec![], new_profile.clone());

        let result = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");

        assert_eq!(result.roads[0].lateral_profile.crossfalls.len(), 1);
        assert_eq!(
            result.roads[0].lateral_profile.crossfalls[0].side,
            new_profile[0].side
        );
    }

    #[test]
    fn test_set_crossfall_undo_restores_profile() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetCrossfall::new(
            "road-1",
            vec![],
            vec![Crossfall {
                s: 0.0,
                a: 0.03,
                b: 0.0,
                c: 0.0,
                d: 0.0,
                side: CrossfallSide::Both,
            }],
        );

        let executed = cmd
            .execute(&project)
            .expect("execute should succeed on valid project");
        let undone = cmd
            .undo(&executed)
            .expect("undo should succeed on previously executed command");

        assert!(undone.roads[0].lateral_profile.crossfalls.is_empty());
    }

    #[test]
    fn test_set_crossfall_execute_missing_road_returns_error() {
        let project = make_project(&[0.0], 100.0);
        let cmd = SetCrossfall::new(
            "missing-road",
            vec![],
            vec![Crossfall {
                s: 0.0,
                a: 0.03,
                b: 0.0,
                c: 0.0,
                d: 0.0,
                side: CrossfallSide::Both,
            }],
        );

        assert!(cmd.execute(&project).is_err());
    }
}
