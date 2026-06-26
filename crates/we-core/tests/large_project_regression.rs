//! Large-project regression guards for the cached pick/snap fast paths.
//!
//! These tests pin the invariant that the **cached** spatial-index and
//! snap-cache code paths (used by the WASM 60 Hz mouse-move bridge) produce
//! results that are identical to the brute-force, rebuild-every-call paths,
//! even on large projects and after incremental single-road edits.
//!
//! They are deterministic (no timing assertions) so they are safe to gate in
//! CI. Quantitative throughput numbers live in `benches/pick_snap_bench.rs`.

use we_core::model::{Geometry, GeometryType, Project, Road};
use we_core::picking::{pick_road, pick_road_cached};
use we_core::snapping::{SnapConfig, snap_point, snap_point_cached};
use we_core::spatial_index::ProjectCache;

/// Build a straight road starting at `(x0, y0)` heading along `+x`.
fn make_road(id: &str, x0: f64, y0: f64, length: f64) -> Road {
    Road::from_centerline(
        id,
        vec![Geometry {
            s: 0.0,
            x: x0,
            y: y0,
            hdg: 0.0,
            length,
            geo_type: GeometryType::Line,
        }],
    )
}

/// Build a deterministic grid of `cols * rows` straight roads.
fn make_grid_project(cols: usize, rows: usize) -> Project {
    let mut project = Project::default();
    for row in 0..rows {
        for col in 0..cols {
            let id = format!("r{row}_{col}");
            let x0 = col as f64 * 150.0;
            let y0 = row as f64 * 30.0;
            project.roads.push(make_road(&id, x0, y0, 100.0));
        }
    }
    project
}

/// Deterministic set of query points spread across the grid extent.
fn query_points(cols: usize, rows: usize) -> Vec<(f64, f64)> {
    let mut pts = Vec::new();
    for row in 0..rows {
        for col in 0..cols {
            let x = col as f64 * 150.0 + 50.0;
            let y = row as f64 * 30.0;
            pts.push((x, y)); // on-surface
            pts.push((x + 37.0, y + 7.5)); // near / between
            pts.push((x - 500.0, y - 500.0)); // far miss
        }
    }
    pts
}

fn assert_pick_eq(a: &Option<we_core::picking::PickResult>, b: &Option<we_core::picking::PickResult>) {
    match (a, b) {
        (None, None) => {}
        (Some(x), Some(y)) => {
            assert_eq!(x.id, y.id, "picked id diverged");
            assert!((x.distance - y.distance).abs() < 1e-9, "pick distance diverged");
        }
        _ => panic!("cached pick presence diverged: {a:?} vs {b:?}"),
    }
}

#[test]
fn cached_pick_matches_bruteforce_on_large_project() {
    let project = make_grid_project(40, 25); // 1000 roads
    let mut cache = ProjectCache::new(project.clone());
    let threshold = 6.0;

    for (x, y) in query_points(40, 25) {
        let brute = pick_road(&project, x, y, threshold);
        let cached = pick_road_cached(&mut cache, x, y, threshold);
        assert_pick_eq(&brute, &cached);
    }
}

#[test]
fn cached_snap_matches_bruteforce_on_large_project() {
    // Equivalence does not require 1000 roads; keep the grid modest so the
    // O(n)-per-call brute-force baseline stays fast enough to gate in CI.
    const COLS: usize = 12;
    const ROWS: usize = 8;
    let project = make_grid_project(COLS, ROWS); // 96 roads
    let mut cache = ProjectCache::new(project.clone());
    let config = SnapConfig {
        grid_enabled: true,
        grid_size: 1.0,
        endpoint_enabled: true,
        endpoint_threshold: 5.0,
        snap_to_lane_endpoints: false,
        midpoint_enabled: true,
        perpendicular_enabled: false,
    };

    // Query near road endpoints to exercise the endpoint snap candidates.
    for row in 0..ROWS {
        for col in 0..COLS {
            let x0 = col as f64 * 150.0;
            let y0 = row as f64 * 30.0;
            for (qx, qy) in [(x0 + 2.0, y0 + 1.0), (x0 + 100.0 - 2.0, y0 + 1.0)] {
                let brute = snap_point(qx, qy, &config, &project, None);
                let cached = snap_point_cached(qx, qy, &config, &mut cache, None);
                assert_eq!(brute.snapped, cached.snapped, "snap flag diverged");
                assert_eq!(brute.snap_type, cached.snap_type, "snap type diverged");
                assert_eq!(brute.target_id, cached.target_id, "snap target diverged");
                assert!((brute.x - cached.x).abs() < 1e-9, "snap x diverged");
                assert!((brute.y - cached.y).abs() < 1e-9, "snap y diverged");
            }
        }
    }
}

#[test]
fn incremental_index_update_matches_full_rebuild_after_edit() {
    let mut project = make_grid_project(30, 20); // 600 roads
    let mut cache = ProjectCache::new(project.clone());
    let threshold = 6.0;

    // Warm the cache so a spatial index exists (enables the incremental path).
    let _ = pick_road_cached(&mut cache, 50.0, 0.0, threshold);

    // Move a single road far away, in both the live project and the cache.
    let edited_id = "r5_10".to_string();
    let moved = make_road(&edited_id, 9000.0, 9000.0, 100.0);
    for road in &mut project.roads {
        if road.id == edited_id {
            *road = moved.clone();
        }
    }
    for road in &mut cache.project.roads {
        if road.id == edited_id {
            *road = moved.clone();
        }
    }
    // Incremental fast-path invalidation for just the edited road.
    cache.invalidate_road(&edited_id);

    // The moved road must now be pickable at its NEW location and absent at the old.
    for (x, y) in [
        (9050.0, 9000.0), // new location — should hit the moved road
        (1550.0, 150.0),  // old location of r5_10 — should no longer hit it
        (50.0, 0.0),      // an untouched road — must be unaffected
    ] {
        let brute = pick_road(&project, x, y, threshold);
        let cached = pick_road_cached(&mut cache, x, y, threshold);
        assert_pick_eq(&brute, &cached);
    }
}
