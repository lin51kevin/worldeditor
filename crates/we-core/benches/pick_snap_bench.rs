//! Quantitative pick/snap throughput benchmarks at 100 / 1k / 10k roads.
//!
//! Compares the brute-force "rebuild every call" path (what the WASM bridge
//! used to do on every 60 Hz mouse move) against the cached [`ProjectCache`]
//! fast path. Run with:
//!
//! ```text
//! cargo bench -p we-core --bench pick_snap_bench
//! ```

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use std::hint::black_box;

use we_core::model::{Geometry, GeometryType, Project, Road};
use we_core::picking::{pick_road, pick_road_cached};
use we_core::snapping::{SnapConfig, snap_point, snap_point_cached};
use we_core::spatial_index::ProjectCache;

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

/// Build a roughly square grid of `n` straight roads.
fn make_project(n: usize) -> Project {
    let cols = (n as f64).sqrt().ceil() as usize;
    let mut project = Project::default();
    for i in 0..n {
        let col = i % cols;
        let row = i / cols;
        let x0 = col as f64 * 150.0;
        let y0 = row as f64 * 30.0;
        project.roads.push(make_road(&format!("r{i}"), x0, y0, 100.0));
    }
    project
}

/// A spread of query points that hit, miss, and graze the network.
fn query_points(n: usize) -> Vec<(f64, f64)> {
    let cols = (n as f64).sqrt().ceil() as usize;
    let mut pts = Vec::new();
    for i in (0..n).step_by((n / 64).max(1)) {
        let col = i % cols;
        let row = i / cols;
        let x = col as f64 * 150.0 + 50.0;
        let y = row as f64 * 30.0;
        pts.push((x, y));
        pts.push((x + 40.0, y + 8.0));
    }
    pts
}

fn bench_pick(c: &mut Criterion) {
    let mut group = c.benchmark_group("pick_road");
    for &n in &[100usize, 1_000, 10_000] {
        let project = make_project(n);
        let points = query_points(n);

        group.bench_with_input(BenchmarkId::new("bruteforce", n), &n, |b, _| {
            b.iter(|| {
                for &(x, y) in &points {
                    black_box(pick_road(&project, x, y, 6.0));
                }
            });
        });

        group.bench_with_input(BenchmarkId::new("cached", n), &n, |b, _| {
            let mut cache = ProjectCache::new(project.clone());
            // Warm the index once, then measure steady-state queries.
            let _ = pick_road_cached(&mut cache, 0.0, 0.0, 6.0);
            b.iter(|| {
                for &(x, y) in &points {
                    black_box(pick_road_cached(&mut cache, x, y, 6.0));
                }
            });
        });
    }
    group.finish();
}

fn bench_snap(c: &mut Criterion) {
    let config = SnapConfig::default();
    let mut group = c.benchmark_group("snap_point");
    for &n in &[100usize, 1_000, 10_000] {
        let project = make_project(n);
        let points = query_points(n);

        group.bench_with_input(BenchmarkId::new("bruteforce", n), &n, |b, _| {
            b.iter(|| {
                for &(x, y) in &points {
                    black_box(snap_point(x, y, &config, &project, None));
                }
            });
        });

        group.bench_with_input(BenchmarkId::new("cached", n), &n, |b, _| {
            let mut cache = ProjectCache::new(project.clone());
            let _ = snap_point_cached(0.0, 0.0, &config, &mut cache, None);
            b.iter(|| {
                for &(x, y) in &points {
                    black_box(snap_point_cached(x, y, &config, &mut cache, None));
                }
            });
        });
    }
    group.finish();
}

criterion_group!(benches, bench_pick, bench_snap);
criterion_main!(benches);
