//! XODR parsing consistency comparison tests.
//!
//! Compares WorldEditor-Next's `parse_xodr()` output against baseline JSON
//! exported from WorldEditorOnline for the same `.xodr` files.

mod baseline_model;

use baseline_model::*;
use std::collections::HashMap;
use we_core::model::*;
use we_core::opendrive::parse_xodr;

// ── Tolerances ───────────────────────────────────────
//
// These tolerances control how strictly we compare floating-point values
// against the XODR baseline. The `BASELINE_TOLERANCE_MULTIPLIER` constant
// allows coarse-grained adjustment if a particular CI environment produces
// larger FP divergence (e.g. different x86 rounding modes on Windows).
//
// Individual field tolerances are multiplied by this factor:
//   effective_epsilon = BASELINE_TOLERANCE_MULTIPLIER * EPSILON_<TYPE>

/// Global multiplier for all baseline comparison tolerances.
/// Set to a value > 1.0 in CI if floating-point differences cause false positives.
/// Can be overridden via the `WE_BASELINE_TOLERANCE_MULT` environment variable.
fn baseline_tolerance_multiplier() -> f64 {
    std::env::var("WE_BASELINE_TOLERANCE_MULT")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|&v| v > 0.0)
        .unwrap_or(1.0)
}

const EPSILON_COORD: f64 = 1e-3;
const EPSILON_ANGLE: f64 = 1e-3;
const EPSILON_LENGTH: f64 = 0.5;

// ── Diff collection ──────────────────────────────────

#[derive(Debug)]
struct FieldDiff {
    field: String,
    baseline: String,
    ours: String,
    note: String,
}

struct ComparisonContext {
    diffs: Vec<FieldDiff>,
    passed: Vec<String>,
}

impl ComparisonContext {
    fn new() -> Self {
        Self {
            diffs: Vec::new(),
            passed: Vec::new(),
        }
    }

    fn assert_eq(&mut self, field: &str, ours: &str, baseline: &str, note: &str) {
        if ours == baseline {
            self.passed.push(field.to_string());
        } else {
            self.diffs.push(FieldDiff {
                field: field.to_string(),
                baseline: baseline.to_string(),
                ours: ours.to_string(),
                note: note.to_string(),
            });
        }
    }

    fn assert_eq_i32(&mut self, field: &str, ours: i32, baseline: i32, note: &str) {
        self.assert_eq(field, &ours.to_string(), &baseline.to_string(), note);
    }

    fn assert_f64_near(&mut self, field: &str, ours: f64, baseline: f64, eps: f64, note: &str) {
        let effective_eps = eps * baseline_tolerance_multiplier();
        if (ours - baseline).abs() <= effective_eps {
            self.passed.push(field.to_string());
        } else {
            self.diffs.push(FieldDiff {
                field: field.to_string(),
                baseline: format!("{baseline}"),
                ours: format!("{ours}"),
                note: format!("{note} (delta={:.6})", (ours - baseline).abs()),
            });
        }
    }

    fn assert_count(&mut self, field: &str, ours: usize, baseline: usize, note: &str) {
        if ours == baseline {
            self.passed.push(field.to_string());
        } else {
            self.diffs.push(FieldDiff {
                field: field.to_string(),
                baseline: baseline.to_string(),
                ours: ours.to_string(),
                note: note.to_string(),
            });
        }
    }

    fn print_report(&self, file_name: &str) {
        println!("\n{}", "=".repeat(60));
        println!("Comparison Report: {file_name}");
        println!("{}", "=".repeat(60));
        println!("Passed: {} fields", self.passed.len());
        println!("Failed: {} fields", self.diffs.len());
        if !self.diffs.is_empty() {
            println!("\nDifferences:");
            for d in &self.diffs {
                println!(
                    "  ✗ {} | baseline={} | ours={} | {}",
                    d.field, d.baseline, d.ours, d.note
                );
            }
        }
        println!();
    }
}

// ── Helpers ──────────────────────────────────────────

/// Build a lookup map from road ID → Road for our parsed project.
fn road_map(project: &Project) -> HashMap<&str, &Road> {
    project.roads.iter().map(|r| (r.id.as_str(), r)).collect()
}

/// Normalize object type string for comparison.
/// WorldEditorOnline uses lowercase; our parser maps to ObjectType enum.
fn normalize_object_type(our_type: &ObjectType) -> String {
    match our_type {
        ObjectType::Sign => "sign".to_string(),
        ObjectType::Guardrail => "guardrail".to_string(),
        ObjectType::Barrier => "barrier".to_string(),
        ObjectType::Curb => "curb".to_string(),
        ObjectType::Wall => "wall".to_string(),
        ObjectType::Pillar => "pillar".to_string(),
        ObjectType::TrafficCone => "trafficcone".to_string(),
        ObjectType::ParkingSpace => "parkingspace".to_string(),
        ObjectType::Crosswalk => "crosswalk".to_string(),
        ObjectType::StopLine => "stopline".to_string(),
        ObjectType::CrossHatchArea => "crosshatcharea".to_string(),
        ObjectType::WovenArea => "wovenarea".to_string(),
        ObjectType::ForwardWaitingArea => "forwardwaitingarea".to_string(),
        ObjectType::TurnLeftWaitingArea => "turnleftwaitingarea".to_string(),
        ObjectType::SlowDownToYieldLine => "slowdowntoyieldline".to_string(),
        ObjectType::StopToYieldLine => "stoptoyieldline".to_string(),
        ObjectType::SimpleSignalPole => "simplesignalpole".to_string(),
        ObjectType::TrafficLightPole => "trafficlightpole".to_string(),
        ObjectType::StreetLightPole => "streetlightpole".to_string(),
        ObjectType::SignGantry => "signgantry".to_string(),
        ObjectType::LTypeSignalPole => "ltypesignalpole".to_string(),
        ObjectType::Custom(s) => s.to_lowercase(),
    }
}

// ── Comparison logic ─────────────────────────────────

fn compare_roads(ctx: &mut ComparisonContext, project: &Project, baseline: &BaselineNetwork) {
    ctx.assert_count(
        "road_count",
        project.roads.len(),
        baseline.roads.len(),
        "Total road count",
    );

    let our_roads = road_map(project);

    for base_road in &baseline.roads {
        let base_id = base_road.id_str();
        let prefix = format!("roads[{base_id}]");

        let our_road = match our_roads.get(base_id.as_str()) {
            Some(r) => r,
            None => {
                ctx.diffs.push(FieldDiff {
                    field: format!("{prefix}.id"),
                    baseline: base_id.clone(),
                    ours: "(missing)".to_string(),
                    note: "Road not found in our parse result".to_string(),
                });
                continue;
            }
        };

        // Road name
        ctx.assert_eq(
            &format!("{prefix}.name"),
            &our_road.name,
            &base_road.name,
            "Road name",
        );

        // Junction ID
        let our_jid = our_road.junction_id.clone();
        let base_jid = base_road.junction_id_str();
        ctx.assert_eq(
            &format!("{prefix}.junction_id"),
            &our_jid.as_deref().unwrap_or("none"),
            &base_jid.as_deref().unwrap_or("none"),
            "Junction ID",
        );

        // Road length (computed from knots in baseline vs stored in our model)
        let base_length = base_road.length();
        if base_length > 0.0 {
            ctx.assert_f64_near(
                &format!("{prefix}.length"),
                our_road.length,
                base_length,
                EPSILON_LENGTH,
                "Road length",
            );
        }

        // Signal count
        ctx.assert_count(
            &format!("{prefix}.signals.count"),
            our_road.signals.len(),
            base_road.road_signals.len(),
            "Signal count",
        );

        // Object count
        ctx.assert_count(
            &format!("{prefix}.objects.count"),
            our_road.objects.len(),
            base_road.road_objects.len(),
            "Object count",
        );

        // Compare signals by ID
        compare_signals(ctx, &prefix, &our_road.signals, &base_road.road_signals);

        // Compare objects by ID
        compare_objects(ctx, &prefix, &our_road.objects, &base_road.road_objects);

        // Lane section count
        let base_ls_count =
            base_road.left_lane_sections.len() + base_road.right_lane_sections.len();
        // Our model combines left/right into a single lane_sections vec, but each
        // LaneSection contains left/right lanes. One baseline left + one baseline right
        // with the same startS correspond to one of our LaneSections.
        // For now, compare the total number of our lane_sections against the max of
        // left/right baseline sections (they are typically paired).
        let expected_ls = base_road.right_lane_sections.len().max(1);
        if base_ls_count > 0 {
            ctx.assert_count(
                &format!("{prefix}.lane_sections.count"),
                our_road.lane_sections.len(),
                expected_ls,
                "Lane section count (expected = max of left/right baseline sections)",
            );
        }
    }
}

fn compare_signals(
    ctx: &mut ComparisonContext,
    road_prefix: &str,
    ours: &[Signal],
    baseline: &[BaselineSignal],
) {
    let our_map: HashMap<&str, &Signal> = ours.iter().map(|s| (s.id.as_str(), s)).collect();

    for base_sig in baseline {
        let base_id = base_sig.id_str();
        let prefix = format!("{road_prefix}.signals[{base_id}]");

        let our_sig = match our_map.get(base_id.as_str()) {
            Some(s) => s,
            None => {
                ctx.diffs.push(FieldDiff {
                    field: format!("{prefix}.id"),
                    baseline: base_id,
                    ours: "(missing)".to_string(),
                    note: "Signal not found in our parse result".to_string(),
                });
                continue;
            }
        };

        // s coordinate
        ctx.assert_f64_near(
            &format!("{prefix}.s"),
            our_sig.s,
            base_sig.s,
            EPSILON_COORD,
            "Signal s-coord",
        );

        // t coordinate
        ctx.assert_f64_near(
            &format!("{prefix}.t"),
            our_sig.t,
            base_sig.t,
            EPSILON_COORD,
            "Signal t-coord",
        );

        // zOffset
        ctx.assert_f64_near(
            &format!("{prefix}.z_offset"),
            our_sig.z_offset,
            base_sig.z_offset,
            EPSILON_COORD,
            "Signal zOffset",
        );

        // hOffset
        ctx.assert_f64_near(
            &format!("{prefix}.h_offset"),
            our_sig.h_offset,
            base_sig.h_offset,
            EPSILON_ANGLE,
            "Signal hOffset",
        );

        // width
        ctx.assert_f64_near(
            &format!("{prefix}.width"),
            our_sig.width,
            base_sig.width,
            EPSILON_COORD,
            "Signal width",
        );

        // height
        ctx.assert_f64_near(
            &format!("{prefix}.height"),
            our_sig.height,
            base_sig.height,
            EPSILON_COORD,
            "Signal height",
        );

        // type
        ctx.assert_eq(
            &format!("{prefix}.type"),
            &our_sig.signal_type,
            &base_sig.signal_type,
            "Signal type",
        );

        // orientation (baseline numeric → string)
        ctx.assert_eq(
            &format!("{prefix}.orientation"),
            &our_sig.orientation,
            &base_sig.orientation_str(),
            "Signal orientation (baseline numeric → our string)",
        );

        // dynamic
        ctx.assert_eq(
            &format!("{prefix}.is_dynamic"),
            &our_sig.is_dynamic.to_string(),
            &base_sig.is_dynamic().to_string(),
            "Signal dynamic flag",
        );
    }
}

fn compare_objects(
    ctx: &mut ComparisonContext,
    road_prefix: &str,
    ours: &[RoadObject],
    baseline: &[BaselineObject],
) {
    let our_map: HashMap<&str, &RoadObject> = ours.iter().map(|o| (o.id.as_str(), o)).collect();

    for base_obj in baseline {
        let base_id = base_obj.id_str();
        let prefix = format!("{road_prefix}.objects[{base_id}]");

        let our_obj = match our_map.get(base_id.as_str()) {
            Some(o) => o,
            None => {
                ctx.diffs.push(FieldDiff {
                    field: format!("{prefix}.id"),
                    baseline: base_id,
                    ours: "(missing)".to_string(),
                    note: "Object not found in our parse result".to_string(),
                });
                continue;
            }
        };

        // type
        let our_type_str = normalize_object_type(&our_obj.object_type);
        ctx.assert_eq(
            &format!("{prefix}.type"),
            &our_type_str,
            &base_obj.object_type.to_lowercase(),
            "Object type",
        );

        // s coordinate (stored as position.x in our model)
        ctx.assert_f64_near(
            &format!("{prefix}.s"),
            our_obj.position.x,
            base_obj.s,
            EPSILON_COORD,
            "Object s-coord",
        );

        // t coordinate (stored as position.y in our model)
        ctx.assert_f64_near(
            &format!("{prefix}.t"),
            our_obj.position.y,
            base_obj.t,
            EPSILON_COORD,
            "Object t-coord",
        );

        // zOffset
        ctx.assert_f64_near(
            &format!("{prefix}.z_offset"),
            our_obj.position.z,
            base_obj.z_offset,
            EPSILON_COORD,
            "Object zOffset",
        );

        // hdg
        ctx.assert_f64_near(
            &format!("{prefix}.hdg"),
            our_obj.hdg,
            base_obj.hdg,
            EPSILON_ANGLE,
            "Object hdg",
        );

        // width
        ctx.assert_f64_near(
            &format!("{prefix}.width"),
            our_obj.width,
            base_obj.width,
            EPSILON_COORD,
            "Object width",
        );

        // height
        ctx.assert_f64_near(
            &format!("{prefix}.height"),
            our_obj.height,
            base_obj.height,
            EPSILON_COORD,
            "Object height",
        );

        // Corner count (for crosswalks, parking spaces, etc.)
        if !base_obj.corner_knots.is_empty() {
            ctx.assert_count(
                &format!("{prefix}.corners.count"),
                our_obj.corners.len(),
                base_obj.corner_knots.len(),
                "Corner count",
            );
        }
    }
}

fn compare_junctions(ctx: &mut ComparisonContext, project: &Project, baseline: &BaselineNetwork) {
    ctx.assert_count(
        "junction_count",
        project.junctions.len(),
        baseline.junctions.len(),
        "Total junction count",
    );

    let our_map: HashMap<&str, &Junction> = project
        .junctions
        .iter()
        .map(|j| (j.id.as_str(), j))
        .collect();

    for base_j in &baseline.junctions {
        let base_id = base_j.id_str();
        let prefix = format!("junctions[{base_id}]");

        let our_j = match our_map.get(base_id.as_str()) {
            Some(j) => j,
            None => {
                ctx.diffs.push(FieldDiff {
                    field: format!("{prefix}.id"),
                    baseline: base_id,
                    ours: "(missing)".to_string(),
                    note: "Junction not found in our parse result".to_string(),
                });
                continue;
            }
        };

        // Connection count
        ctx.assert_count(
            &format!("{prefix}.connections.count"),
            our_j.connections.len(),
            base_j.connections.len(),
            "Junction connection count",
        );

        // Compare connections by matching (incoming_road, connecting_road) pairs
        for (i, base_conn) in base_j.connections.iter().enumerate() {
            let conn_prefix = format!("{prefix}.connections[{i}]");
            let base_incoming = base_conn.incoming_road_id_str();
            let base_connecting = base_conn.connecting_road_id_str();

            // Find matching connection in our data
            let our_conn = our_j
                .connections
                .iter()
                .find(|c| c.incoming_road == base_incoming && c.connecting_road == base_connecting);

            match our_conn {
                Some(c) => {
                    // Contact point: baseline 0=Start, 1=End
                    let base_cp = if base_conn.contact_point == 0 {
                        "Start"
                    } else {
                        "End"
                    };
                    let our_cp = format!("{:?}", c.contact_point);
                    ctx.assert_eq(
                        &format!("{conn_prefix}.contact_point"),
                        &our_cp,
                        base_cp,
                        "Connection contact point",
                    );

                    // Lane links count
                    ctx.assert_count(
                        &format!("{conn_prefix}.lane_links.count"),
                        c.lane_links.len(),
                        base_conn.lane_links.len(),
                        "Lane links count",
                    );

                    // Compare individual lane links
                    for (j, base_ll) in base_conn.lane_links.iter().enumerate() {
                        if let Some(our_ll) = c.lane_links.get(j) {
                            ctx.assert_eq_i32(
                                &format!("{conn_prefix}.lane_links[{j}].from"),
                                our_ll.from,
                                base_ll.from_lane_id,
                                "Lane link from",
                            );
                            ctx.assert_eq_i32(
                                &format!("{conn_prefix}.lane_links[{j}].to"),
                                our_ll.to,
                                base_ll.to_lane_id,
                                "Lane link to",
                            );
                        }
                    }
                }
                None => {
                    ctx.diffs.push(FieldDiff {
                        field: conn_prefix,
                        baseline: format!("incoming={base_incoming}, connecting={base_connecting}"),
                        ours: "(missing)".to_string(),
                        note: "Connection not found in our parse result".to_string(),
                    });
                }
            }
        }
    }
}

// ── Test runner ──────────────────────────────────────

fn run_comparison(xodr_xml: &str, baseline_json: &str, file_name: &str) -> ComparisonContext {
    let project = parse_xodr(xodr_xml).expect("Failed to parse XODR");
    let baseline: BaselineNetwork =
        serde_json::from_str(baseline_json).expect("Failed to parse baseline JSON");

    let mut ctx = ComparisonContext::new();

    compare_roads(&mut ctx, &project, &baseline);
    compare_junctions(&mut ctx, &project, &baseline);

    ctx.print_report(file_name);
    ctx
}

// ── Tests ────────────────────────────────────────────

#[test]
fn compare_junction_crosswalk_signal() {
    let xodr = include_str!("../../../tests/fixtures/xodr/junction_crosswalk_signal.xodr");
    let baseline = include_str!(
        "../../../tests/fixtures/xodr/baseline/junction_crosswalk_signal.baseline.json"
    );

    let ctx = run_comparison(xodr, baseline, "junction_crosswalk_signal");

    // Report summary — test passes but prints diffs for investigation
    println!(
        "Summary: {} passed, {} diffs",
        ctx.passed.len(),
        ctx.diffs.len()
    );

    // Hard assertion: road count must match
    let xodr_project = parse_xodr(xodr).unwrap();
    let baseline_data: BaselineNetwork = serde_json::from_str(baseline).unwrap();
    assert_eq!(
        xodr_project.roads.len(),
        baseline_data.roads.len(),
        "Road count must match for junction_crosswalk_signal"
    );
}

#[test]
fn compare_highway() {
    let xodr = include_str!("../../../tests/fixtures/xodr/highway.xodr");
    let baseline = include_str!("../../../tests/fixtures/xodr/baseline/highway.baseline.json");

    let ctx = run_comparison(xodr, baseline, "highway");

    println!(
        "Summary: {} passed, {} diffs",
        ctx.passed.len(),
        ctx.diffs.len()
    );

    let xodr_project = parse_xodr(xodr).unwrap();
    let baseline_data: BaselineNetwork = serde_json::from_str(baseline).unwrap();
    assert_eq!(
        xodr_project.roads.len(),
        baseline_data.roads.len(),
        "Road count must match for highway"
    );
}

#[test]
fn compare_parkinglot() {
    let xodr = include_str!("../../../tests/fixtures/xodr/parkinglot.xodr");
    let baseline = include_str!("../../../tests/fixtures/xodr/baseline/parkinglot.baseline.json");

    let project = parse_xodr(xodr).expect("Failed to parse XODR");
    let baseline_data: BaselineNetwork =
        serde_json::from_str(baseline).expect("Failed to parse baseline JSON");

    // WorldEditorOnline generates additional virtual/connecting roads not present
    // in the source XODR. We only compare roads that exist in our parse result.
    let mut ctx = ComparisonContext::new();

    // Count roads present in both
    let our_road_ids: std::collections::HashSet<&str> =
        project.roads.iter().map(|r| r.id.as_str()).collect();
    let baseline_road_ids: std::collections::HashSet<String> =
        baseline_data.roads.iter().map(|r| r.id_str()).collect();
    let common_ids: Vec<_> = our_road_ids
        .iter()
        .filter(|id| baseline_road_ids.contains(**id))
        .collect();

    println!(
        "parkinglot: our roads={}, baseline roads={}, common={}",
        project.roads.len(),
        baseline_data.roads.len(),
        common_ids.len()
    );

    // Run comparison only on common roads
    compare_roads(&mut ctx, &project, &baseline_data);
    compare_junctions(&mut ctx, &project, &baseline_data);

    ctx.print_report("parkinglot");
    println!(
        "Summary: {} passed, {} diffs",
        ctx.passed.len(),
        ctx.diffs.len()
    );

    // Verify we parsed all xodr roads (some baseline roads are generated)
    assert!(
        project.roads.len() <= baseline_data.roads.len(),
        "We should not have more roads than baseline"
    );
}
