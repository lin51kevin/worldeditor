#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


// ── f() formatting ──────────────────────────────

#[test]
fn test_write_f_zero() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].x = 0.0;
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"x="0""#));
}


#[test]
fn test_write_f_integer() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].x = 42.0;
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"x="42.0""#));
}


#[test]
fn test_write_f_fractional() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].x = 1.234;
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"x="1.234""#));
}


// ── Geometry types ──────────────────────────────

#[test]
fn test_write_arc_geometry() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Arc { curvature: 0.05 };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<arc"));
    assert!(xml.contains(r#"curvature="0.05""#));
}


#[test]
fn test_write_spiral_geometry() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.1,
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<spiral"));
    assert!(xml.contains(r#"curvStart="0""#));
    assert!(xml.contains(r#"curvEnd="0.1""#));
}


#[test]
fn test_write_poly3_geometry() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Poly3 {
                a: 1.0,
                b: 2.0,
                c: 3.0,
                d: 4.0,
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<poly3"));
    assert!(xml.contains(r#"a="1.0""#));
    assert!(xml.contains(r#"d="4.0""#));
}


#[test]
fn test_write_param_poly3_geometry_arclength() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 1.0,
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 1.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::ArcLength,
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<paramPoly3"));
    assert!(xml.contains(r#"pRange="arcLength""#));
    assert!(xml.contains(r#"bU="1.0""#));
}


#[test]
fn test_write_param_poly3_geometry_normalized() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 1.0,
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 1.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::Normalized,
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"pRange="normalized""#));
}


// ── Elevation ───────────────────────────────────

#[test]
fn test_write_elevation_profile() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.elevation_profile = vec![
                Elevation {
                    s: 0.0,
                    a: 0.0,
                    b: 0.01,
                    c: 0.0,
                    d: 0.0,
                },
                Elevation {
                    s: 50.0,
                    a: 1.0,
                    b: -0.01,
                    c: 0.0,
                    d: 0.0,
                },
            ];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<elevationProfile>"));
    assert!(xml.contains("</elevationProfile>"));
    let count = xml.matches("<elevation ").count();
    assert_eq!(count, 2);
}


#[test]
fn test_write_elevation_roundtrip() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.elevation_profile = vec![Elevation {
                s: 0.0,
                a: 5.5,
                b: 0.01,
                c: 0.002,
                d: -0.0001,
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    let re = parse_xodr(&xml).unwrap();
    let elev = &re.roads[0].elevation_profile[0];
    assert!((elev.a - 5.5).abs() < 1e-10);
    assert!((elev.b - 0.01).abs() < 1e-10);
    assert!((elev.c - 0.002).abs() < 1e-10);
    assert!((elev.d - (-0.0001)).abs() < 1e-10);
}


// ── Lateral Profile ─────────────────────────────

#[test]
fn test_write_superelevation() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![Superelevation {
                    s: 0.0,
                    a: 0.02,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                crossfalls: vec![],
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<lateralProfile>"));
    assert!(xml.contains("<superelevation "));
}


#[test]
fn test_write_crossfall() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![],
                crossfalls: vec![
                    Crossfall {
                        s: 0.0,
                        a: 0.01,
                        b: 0.0,
                        c: 0.0,
                        d: 0.0,
                        side: CrossfallSide::Both,
                    },
                    Crossfall {
                        s: 50.0,
                        a: -0.01,
                        b: 0.0,
                        c: 0.0,
                        d: 0.0,
                        side: CrossfallSide::Left,
                    },
                ],
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"side="both""#));
    assert!(xml.contains(r#"side="left""#));
}


#[test]
fn test_write_crossfall_right() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![],
                crossfalls: vec![Crossfall {
                    s: 0.0,
                    a: 0.01,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                    side: CrossfallSide::Right,
                }],
            };
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"side="right""#));
}
