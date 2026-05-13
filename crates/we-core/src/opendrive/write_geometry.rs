use quick_xml::Writer;
use quick_xml::events::{BytesEnd, BytesStart, Event};

use super::{OpenDriveError, W, elem_with_attrs, f, w_err};
use crate::model::*;

pub(super) fn write_plan_view(
    writer: &mut Writer<W>,
    geometries: &[Geometry],
) -> Result<(), OpenDriveError> {
    writer
        .write_event(Event::Start(BytesStart::new("planView".to_string())))
        .map_err(w_err)?;

    for geo in geometries {
        let attrs = [
            ("hdg", f(geo.hdg)),
            ("length", f(geo.length)),
            ("s", f(geo.s)),
            ("x", f(geo.x)),
            ("y", f(geo.y)),
        ];
        writer
            .write_event(Event::Start(elem_with_attrs("geometry", &attrs)))
            .map_err(w_err)?;

        write_geometry_type(writer, &geo.geo_type)?;

        writer
            .write_event(Event::End(BytesEnd::new("geometry".to_string())))
            .map_err(w_err)?;
    }

    writer
        .write_event(Event::End(BytesEnd::new("planView".to_string())))
        .map_err(w_err)?;

    Ok(())
}

fn write_geometry_type(
    writer: &mut Writer<W>,
    geo_type: &GeometryType,
) -> Result<(), OpenDriveError> {
    let event = match geo_type {
        GeometryType::Line => Event::Empty(BytesStart::new("line".to_string())),
        GeometryType::Arc { curvature } => {
            Event::Empty(elem_with_attrs("arc", &[("curvature", f(*curvature))]))
        }
        GeometryType::Spiral {
            curv_start,
            curv_end,
        } => Event::Empty(elem_with_attrs(
            "spiral",
            &[("curvStart", f(*curv_start)), ("curvEnd", f(*curv_end))],
        )),
        GeometryType::Poly3 { a, b, c, d } => Event::Empty(elem_with_attrs(
            "poly3",
            &[("a", f(*a)), ("b", f(*b)), ("c", f(*c)), ("d", f(*d))],
        )),
        GeometryType::ParamPoly3 {
            a_u,
            b_u,
            c_u,
            d_u,
            a_v,
            b_v,
            c_v,
            d_v,
            p_range,
        } => {
            let range_str = match p_range {
                ParamPoly3Range::ArcLength => "arcLength",
                ParamPoly3Range::Normalized => "normalized",
            };
            Event::Empty(elem_with_attrs(
                "paramPoly3",
                &[
                    ("aU", f(*a_u)),
                    ("bU", f(*b_u)),
                    ("cU", f(*c_u)),
                    ("dU", f(*d_u)),
                    ("aV", f(*a_v)),
                    ("bV", f(*b_v)),
                    ("cV", f(*c_v)),
                    ("dV", f(*d_v)),
                    ("pRange", range_str.to_string()),
                ],
            ))
        }
    };
    writer.write_event(event).map_err(w_err)?;
    Ok(())
}

