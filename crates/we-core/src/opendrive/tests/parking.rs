#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


#[test]
fn test_parking_space_round_trip() {
    // Test that ParkingSpace objects with outline corners survive parse→write→parse
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.objects = vec![RoadObject {
                id: "ps1".into(),
                name: "Parking Space".into(),
                object_type: ObjectType::ParkingSpace,
                position: Point3D {
                    x: 1.113,
                    y: 3.616,
                    z: 0.01,
                    id: None,
                },
                orientation: 0.0,
                hdg: 1.5707963249607597, // ≈ π/2
                pitch: 7.4e-11,
                roll: 8.8e-10,
                width: 0.0,
                height: 0.0,
                length: 0.0,
                corners: vec![
                    Point3D::new(-0.684, -1.161, 0.03),
                    Point3D::new(2.745, -1.144, 0.03),
                    Point3D::new(2.729, 1.176, 0.03),
                    Point3D::new(-0.716, 1.136, 0.03),
                    Point3D::new(-0.684, -1.161, 0.03),
                ],
                corner_type: CornerType::Local,
                validity: None,
                from_object_ref: false,
                user_data: Vec::new(),
            }];
            r
        }],
        vec![],
    );

    let xml = write_xodr(&p).unwrap();

    // Verify XML structure
    assert!(
        xml.contains(r#"type="ParkingSpace""#),
        "Type should be ParkingSpace"
    );
    assert!(xml.contains("<outline>"), "Should have <outline> wrapper");
    assert!(
        xml.contains("cornerLocal"),
        "Should have cornerLocal elements"
    );
    assert!(
        xml.contains(r#"hdg="1.5707963249607597""#),
        "hdg must be preserved, not orientation"
    );
    assert!(
        xml.contains(r#"orientation="none""#),
        "orientation should be 'none'"
    );
    assert!(
        !xml.contains("<roadObjects>"),
        "Should not use <roadObjects> wrapper"
    );
    assert!(
        !xml.contains("roadObject"),
        "Should use <object> not <roadObject>"
    );

    // Verify round-trip fidelity
    let re = parse_xodr(&xml).unwrap();
    assert_eq!(re.roads[0].objects.len(), 1);
    let obj = &re.roads[0].objects[0];
    assert_eq!(obj.object_type, ObjectType::ParkingSpace);
    assert!(
        (obj.hdg - 1.5707963249607597).abs() < 1e-10,
        "hdg must survive round-trip"
    );
    assert_eq!(
        obj.corners.len(),
        4,
        "Parser removes duplicate closing vertex"
    );
    assert!((obj.corners[0].x - (-0.684)).abs() < 1e-6);
    assert!((obj.corners[0].y - (-1.161)).abs() < 1e-6);
    assert!((obj.corners[0].z - 0.03).abs() < 1e-6);
}


#[test]
fn test_parkinglot_xodr_parse() {
    // Ensure the real parkinglot fixture parses without errors and preserves parking data
    let xodr = std::fs::read_to_string("../../tests/fixtures/xodr/parkinglot.xodr")
        .or_else(|_| std::fs::read_to_string("tests/fixtures/xodr/parkinglot.xodr"));
    if let Ok(xodr) = xodr {
        let project = parse_xodr(&xodr).unwrap();

        // Count parking space objects across all roads
        let parking_count: usize = project
            .roads
            .iter()
            .flat_map(|r| r.objects.iter())
            .filter(|o| o.object_type == ObjectType::ParkingSpace)
            .count();
        assert!(
            parking_count >= 16,
            "Expected at least 16 parking spaces, got {parking_count}"
        );

        // Verify a specific parking space (id=58) has correct data
        let ps58 = project
            .roads
            .iter()
            .flat_map(|r| r.objects.iter())
            .find(|o| o.id == "58");
        assert!(ps58.is_some(), "Parking space id=58 should exist");
        let ps58 = ps58.unwrap();
        assert!(
            (ps58.hdg - 1.5707963249607597).abs() < 1e-6,
            "hdg should be ~π/2"
        );
        assert_eq!(
            ps58.corners.len(),
            4,
            "Parser removes duplicate closing vertex"
        );
        assert!(
            (ps58.pitch - 7.416_453_396_375_846e-11).abs() < 1e-15,
            "pitch should be preserved"
        );
        assert!(
            (ps58.roll - 8.802_067_187_027_583e-10).abs() < 1e-15,
            "roll should be preserved"
        );

        // Round-trip: write and re-parse
        let xml = write_xodr(&project).unwrap();
        let re = parse_xodr(&xml).unwrap();
        let re_parking: usize = re
            .roads
            .iter()
            .flat_map(|r| r.objects.iter())
            .filter(|o| o.object_type == ObjectType::ParkingSpace)
            .count();
        assert_eq!(
            re_parking, parking_count,
            "Round-trip should preserve parking count"
        );

        // Verify hdg is preserved after round-trip
        let re_ps58 = re
            .roads
            .iter()
            .flat_map(|r| r.objects.iter())
            .find(|o| o.id == "58");
        assert!(re_ps58.is_some());
        let re_ps58 = re_ps58.unwrap();
        assert!(
            (re_ps58.hdg - ps58.hdg).abs() < 1e-10,
            "hdg must survive round-trip"
        );
        assert_eq!(
            re_ps58.corners.len(),
            ps58.corners.len(),
            "corners count must survive round-trip"
        );
    }
}


/// Verify all 15 roads produce valid reference line points and all 16 parking
/// objects can be located on their road's reference line.
#[test]
fn test_parkinglot_all_roads_have_valid_geometry() {
    use crate::geometry::eval::sample_road_reference_line;

    let xodr = std::fs::read_to_string("../../tests/fixtures/xodr/parkinglot.xodr")
        .or_else(|_| std::fs::read_to_string("tests/fixtures/xodr/parkinglot.xodr"));
    let Ok(xodr) = xodr else { return };
    let project = parse_xodr(&xodr).unwrap();

    assert_eq!(project.roads.len(), 15, "expected 15 roads");

    let mut total_parking = 0usize;
    for road in &project.roads {
        let pts = sample_road_reference_line(road, 1.0);
        assert!(
            pts.len() >= 2,
            "Road {} must have >=2 ref pts, got {}",
            road.id,
            pts.len()
        );
        // Verify no NaN
        for p in &pts {
            assert!(!p.x.is_nan(), "Road {} has NaN x", road.id);
            assert!(!p.y.is_nan(), "Road {} has NaN y", road.id);
        }
        // Bounding box
        let min_x = pts.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = pts.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
        let min_y = pts.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = pts.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
        println!(
            "Road {}: {} pts, bbox x=[{:.1}, {:.1}] y=[{:.1}, {:.1}]",
            road.id,
            pts.len(),
            min_x,
            max_x,
            min_y,
            max_y
        );

        for obj in &road.objects {
            if obj.object_type == ObjectType::ParkingSpace {
                total_parking += 1;
                // Verify the object can find its ref point
                let s = obj.position.x;
                assert!(
                    s >= 0.0 && s <= road.length + 1e-6,
                    "Parking {} on road {}: s={} out of range [0, {}]",
                    obj.id,
                    road.id,
                    s,
                    road.length
                );
                println!(
                    "  Parking {}: s={:.2} t={:.2} hdg={:.4} corners={}",
                    obj.id,
                    s,
                    obj.position.y,
                    obj.hdg,
                    obj.corners.len()
                );
            }
        }
    }
    assert_eq!(total_parking, 16, "expected 16 parking spaces");
}
