//! GeoZ export: converts an editor [`Project`] into a `.geoz` archive.
//!
//! A `.geoz` file is a ZIP archive containing protobuf-encoded `.topo`
//! (`rt.hdmap.TopoMapFile`) and `.geo` (`rt.hdmap.TileRoadFile`) entries. This
//! module is the reverse of the frontend GeoZ importer: it samples road
//! geometry (curvature-adaptive) into point arrays and maps the domain model
//! onto the `rt.hdmap` protobuf schema.
//!
//! Non-standard scalar attributes of road objects and signals that have no
//! dedicated proto field (heading, pitch, width, corner frame, …) are stored
//! as `userDataList` key/value pairs so a round-trip through the extended GeoZ
//! importer is loss-free.

use std::io::{Cursor, Write};

use prost::Message;
use thiserror::Error;
use we_core::geometry::eval::{
    TessellationParams, evaluate_elevation, evaluate_road_at_s, offset_point,
    sample_road_reference_line_adaptive,
};
use we_core::lane_ops::sample_lane_boundary;
use we_core::model::{
    ContactPoint, Junction, Lane, LaneSection, LaneType, LinkElementType, ObjectType, Project,
    Road, RoadLink, RoadMark, RoadMarkColor, RoadMarkType, RoadMarkWeight, RoadObject, Signal,
};

/// Generated protobuf types for the `rt.hdmap` package (see `build.rs`).
#[allow(clippy::all, non_snake_case, rustdoc::all)]
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/rt.hdmap.rs"));
}

/// Errors that can occur while building a GeoZ archive.
#[derive(Debug, Error)]
pub enum GeozExportError {
    /// Failure writing an entry into the ZIP container.
    #[error("failed to build GeoZ ZIP archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    /// Failure writing raw bytes into the ZIP stream.
    #[error("failed to write GeoZ archive bytes: {0}")]
    Io(#[from] std::io::Error),
}

/// GeoZ format version written into the topo/tile headers.
const GEOZ_VERSION: &str = "1.6";
/// Producer tag written into the topo header `vender` field.
const GEOZ_VENDER: &str = "worldeditor-next";
/// Fixed step (metres) for sampling lane boundaries; matches the reference
/// exporter's ~1 m resample density (avoids over-sampling at 0.5 m).
const GEOZ_LANE_STEP: f64 = 1.0;

/// Export a [`Project`] into a `.geoz` (ZIP) byte buffer.
///
/// The archive contains a single `<name>.topo` entry (all road topology and
/// junctions) plus one `road_<index>.geo` entry per road (reference-line and
/// lane-boundary geometry). Geometry is sampled with curvature-adaptive
/// tessellation so straight sections stay sparse while curves are refined
/// within [`TessellationParams::default`]'s chord-error tolerance.
pub fn export_to_geoz(project: &Project) -> Result<Vec<u8>, GeozExportError> {
    let topo = build_topo_map(project);
    let topo_bytes = topo.encode_to_vec();

    // Each road's geometry is written to `<roadId>.geo` so the entry name
    // matches the road id (the importer also matches by `road_geometry.id`).
    let geo_files: Vec<(String, Vec<u8>)> = project
        .roads
        .iter()
        .enumerate()
        .map(|(index, road)| {
            let stem = sanitize_stem_or(&road.id, &format!("road_{index}"));
            (stem, build_tile_road(road).encode_to_vec())
        })
        .collect();

    let name = sanitize_stem(if project.name.is_empty() {
        "worldeditor"
    } else {
        &project.name
    });

    let mut buffer = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
        // DEFLATE via flate2's pure-Rust miniz_oxide backend keeps the writer
        // wasm32-compatible while matching the original GeoZ files' compression
        // (uncompressed STORED entries would inflate the archive ~30%).
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(9));

        writer.start_file(format!("{name}.topo"), options)?;
        writer.write_all(&topo_bytes)?;

        for (stem, geo_bytes) in &geo_files {
            writer.start_file(format!("{stem}.geo"), options)?;
            writer.write_all(geo_bytes)?;
        }

        writer.finish()?;
    }

    Ok(buffer)
}

// ============================================================================
// Topology (.topo)
// ============================================================================

fn build_topo_map(project: &Project) -> proto::TopoMapFile {
    proto::TopoMapFile {
        header: Some(proto::TopoHeader {
            version: GEOZ_VERSION.to_string(),
            major: "1".to_string(),
            minor: "6".to_string(),
            proj: String::new(),
            vender: GEOZ_VENDER.to_string(),
            r#type: String::new(),
            name: project.name.clone(),
            md5: String::new(),
        }),
        roads: project.roads.iter().map(build_road_topo).collect(),
        junctions: project.junctions.iter().map(build_junction_topo).collect(),
    }
}

fn build_road_topo(road: &Road) -> proto::RoadTopo {
    let (predecessors, successors) = build_road_links(road.link.as_ref());

    // Objects: parking spaces to their own list, everything else to road_objects.
    let mut road_objects = Vec::new();
    let mut road_parking_space = Vec::new();
    for object in &road.objects {
        let proto_object = build_object(object, road);
        if object.object_type == ObjectType::ParkingSpace {
            road_parking_space.push(proto::ParkingSpace {
                obj: Some(proto_object),
                front: None,
                rear: None,
                left: None,
                right: None,
            });
        } else {
            road_objects.push(proto_object);
        }
    }

    proto::RoadTopo {
        header: Some(proto::RoadHeader {
            id: road.id.clone(),
            length: road.length,
            name: road.name.clone(),
            junction_id: road.junction_id.clone().unwrap_or_default(),
            speed_limit: road.speed.unwrap_or(0.0),
            speed_unit: proto::road_header::SpeedUnit::MpS as i32,
            road_type: proto::road_header::RoadType::Unknown as i32,
        }),
        road_predecessors: predecessors,
        road_successors: successors,
        road_sections: build_road_sections(road),
        road_objects,
        road_parking_space,
        road_signal: road
            .signals
            .iter()
            .map(|signal| build_signal(signal, road))
            .collect(),
        road_signal_reference: Vec::new(),
        road_object_reference: Vec::new(),
    }
}

fn build_road_links(link: Option<&RoadLink>) -> (Vec<proto::Roadlink>, Vec<proto::Roadlink>) {
    let mut predecessors = Vec::new();
    let mut successors = Vec::new();
    let Some(link) = link else {
        return (predecessors, successors);
    };

    if let Some(pred) = &link.predecessor {
        predecessors.push(build_roadlink(pred));
    }
    if let Some(succ) = &link.successor {
        successors.push(build_roadlink(succ));
    }
    (predecessors, successors)
}

fn build_roadlink(element: &we_core::model::LinkElement) -> proto::Roadlink {
    let link_type = match element.element_type {
        LinkElementType::Junction => proto::roadlink::RoadLinkType::Junction,
        LinkElementType::Road => proto::roadlink::RoadLinkType::Road,
    };
    let contact = match element.contact_point {
        Some(ContactPoint::End) => proto::roadlink::RoadLinkContactPoint::End,
        _ => proto::roadlink::RoadLinkContactPoint::Start,
    };
    proto::Roadlink {
        id: element.element_id.clone(),
        s: 0.0,
        link_dir: proto::roadlink::RoadLinkDir::Positive as i32,
        link_type: link_type as i32,
        link_contact_point: contact as i32,
    }
}

/// Emit one LEFT and one RIGHT `RoadSection` per model lane section, sharing the
/// same `section_id`/`section_index`/`s` so the importer merges them back into
/// a single [`LaneSection`]. Lanes are ordered so the importer's index-based id
/// assignment (`+1,+2,…` / `-1,-2,…`) reproduces the original ids.
fn build_road_sections(road: &Road) -> Vec<proto::RoadSection> {
    let mut sections = Vec::new();

    for (index, section) in road.lane_sections.iter().enumerate() {
        let section_id = format!("{}_{}", road.id, index);
        let length = section_length(road, section, index);

        let mut left: Vec<&Lane> = section.left.iter().collect();
        left.sort_by_key(|lane| lane.id); // 1, 2, 3, …
        let mut right: Vec<&Lane> = section.right.iter().collect();
        right.sort_by(|a, b| b.id.cmp(&a.id)); // -1, -2, -3, …

        // Ids of all surface lanes in this section (drives neighbour links).
        let sibling_ids: Vec<i32> = left
            .iter()
            .chain(right.iter())
            .map(|lane| lane.id)
            .collect();

        // The reference exporter emits a virtual CENTER_LINE lane per section;
        // the consumer relies on it (section centre reference). Include it as the
        // first lane on each side, mirroring `mSectionRoadCenterLine`.
        let center_lane = build_center_lane_topo(&section_id);
        let mut left_lanes = vec![center_lane.clone()];
        left_lanes.extend(
            left.iter()
                .map(|lane| build_lane_topo(lane, &section_id, &sibling_ids)),
        );
        let mut right_lanes = vec![center_lane];
        right_lanes.extend(
            right
                .iter()
                .map(|lane| build_lane_topo(lane, &section_id, &sibling_ids)),
        );

        sections.push(proto::RoadSection {
            section_id: section_id.clone(),
            section_index: index as u32,
            s: section.s,
            length,
            section_direction_type: proto::road_section::Type::LeftSection as i32,
            lanes: left_lanes,
        });
        sections.push(proto::RoadSection {
            section_id,
            section_index: index as u32,
            s: section.s,
            length,
            section_direction_type: proto::road_section::Type::RightSection as i32,
            lanes: right_lanes,
        });
    }

    sections
}

fn section_length(road: &Road, section: &LaneSection, index: usize) -> f64 {
    let next_s = road
        .lane_sections
        .get(index + 1)
        .map(|next| next.s)
        .unwrap_or(road.length);
    (next_s - section.s).max(0.0)
}

fn build_lane_topo(lane: &Lane, section_id: &str, sibling_ids: &[i32]) -> proto::LaneTopo {
    let (predecessors, successors) = match &lane.link {
        Some(link) => (
            link.predecessor
                .map(|id| vec![proto::LaneLink { id: id.to_string() }])
                .unwrap_or_default(),
            link.successor
                .map(|id| vec![proto::LaneLink { id: id.to_string() }])
                .unwrap_or_default(),
        ),
        None => (Vec::new(), Vec::new()),
    };

    // Neighbours: the lane immediately toward +t (id+1) / -t (id-1), emitted
    // only when such a lane exists in the same section.
    let neighbour = |id: i32| -> Vec<proto::LaneLink> {
        if sibling_ids.contains(&id) {
            vec![proto::LaneLink {
                id: lane_geometry_id(section_id, id),
            }]
        } else {
            Vec::new()
        }
    };
    let left_neighbors = neighbour(lane.id + 1);
    let right_neighbors = neighbour(lane.id - 1);

    proto::LaneTopo {
        header: Some(proto::LaneHeader {
            // Unique per lane per section so the .geo LaneGeometry matches; the
            // importer derives the actual lane id from array order, not this id.
            // Format `roadId_sectionIndex_laneId` mirrors the reference mGuidId.
            id: lane_geometry_id(section_id, lane.id),
            length: 0.0,
            lane_type: lane_type_to_proto(lane.lane_type) as i32,
            lane_turn: proto::lane_header::LaneTurn::NoTurn as i32,
            speed_limit: 0.0,
            speed_unit: proto::lane_header::SpeedUnit::MpS as i32,
            virtual_type: proto::lane_header::LaneVirtualType::NoVirtual as i32,
            name: lane_geometry_id(section_id, lane.id),
        }),
        predecessors,
        successors,
        left_neighbors,
        right_neighbors,
    }
}

/// Virtual CENTER_LINE lane for a section (id `<section_id>_0`). The reference
/// exporter always emits it; the consumer stores it as the section's centre
/// reference (`mSectionRoadCenterLine`) and dereferences it without null checks,
/// so omitting it makes the original consumer fail to parse.
fn build_center_lane_topo(section_id: &str) -> proto::LaneTopo {
    let id = lane_geometry_id(section_id, 0);
    proto::LaneTopo {
        header: Some(proto::LaneHeader {
            id: id.clone(),
            length: 0.0,
            lane_type: proto::lane_header::LaneType::None as i32,
            lane_turn: proto::lane_header::LaneTurn::NoTurn as i32,
            speed_limit: -1.0,
            speed_unit: proto::lane_header::SpeedUnit::MpS as i32,
            virtual_type: proto::lane_header::LaneVirtualType::CenterLine as i32,
            name: id,
        }),
        predecessors: Vec::new(),
        successors: Vec::new(),
        left_neighbors: Vec::new(),
        right_neighbors: Vec::new(),
    }
}

fn build_junction_topo(junction: &Junction) -> proto::JunctionTopo {
    proto::JunctionTopo {
        header: Some(proto::JunctionHeader {
            id: junction.id.clone(),
            name: junction.name.clone(),
            center: None,
        }),
        junction_links: junction
            .connections
            .iter()
            .map(|conn| proto::Junctionlink {
                connecting_road: conn.connecting_road.clone(),
                incoming_road: conn.incoming_road.clone(),
                contact_point: match conn.contact_point {
                    ContactPoint::End => proto::junctionlink::JunctionLinkContactPoint::End as i32,
                    ContactPoint::Start => {
                        proto::junctionlink::JunctionLinkContactPoint::Start as i32
                    }
                },
                junction_lane_link: conn
                    .lane_links
                    .iter()
                    .map(|ll| proto::JunctionLaneLink {
                        from: ll.from.to_string(),
                        to: ll.to.to_string(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

// ============================================================================
// Geometry (.geo)
// ============================================================================

fn build_tile_road(road: &Road) -> proto::TileRoadFile {
    proto::TileRoadFile {
        header: Some(proto::TileHeader {
            version: GEOZ_VERSION.to_string(),
            name: road.id.clone(),
            total_tile: 1,
        }),
        road_geometry: Some(build_road_geometry(road)),
    }
}

fn build_road_geometry(road: &Road) -> proto::RoadGeometry {
    let params = TessellationParams::default();
    let reference_points: Vec<proto::Point3D> = sample_road_reference_line_adaptive(road, &params)
        .into_iter()
        .map(|p| proto::Point3D {
            x: p.x,
            y: p.y,
            z: evaluate_elevation(&road.elevation_profile, p.s),
        })
        .collect();

    proto::RoadGeometry {
        id: road.id.clone(),
        // The road centre-line goes in `center_line` to match the reference GeoZ
        // exporter (SimOne consumers read it); the importer accepts either field.
        reference_line: None,
        center_line: Some(proto::RoadBoundary {
            point: reference_points,
        }),
        lane_geometrys: build_lane_geometries(road),
    }
}

fn build_lane_geometries(road: &Road) -> Vec<proto::LaneGeometry> {
    let mut geometries = Vec::new();

    for (index, section) in road.lane_sections.iter().enumerate() {
        let section_id = format!("{}_{}", road.id, index);
        // Virtual centre-line lane geometry (matches the CENTER_LINE topo lane).
        geometries.push(build_center_lane_geometry(road, section, &section_id));
        for lane in section.left.iter().chain(section.right.iter()) {
            if lane.id == 0 {
                continue; // centre lane handled above
            }
            geometries.push(build_lane_geometry(road, section, lane, &section_id));
        }
    }

    geometries
}

/// Geometry for the virtual CENTER_LINE lane: the section centre-line sampled
/// once, mirrored into all three boundaries (marked virtual), so the consumer's
/// centre reference has usable knots.
fn build_center_lane_geometry(
    road: &Road,
    section: &LaneSection,
    section_id: &str,
) -> proto::LaneGeometry {
    let center = sample_lane_boundary(road, section.s, 0, GEOZ_LANE_STEP);
    let points: Vec<proto::Point3D> = center.iter().map(boundary_to_point).collect();
    let boundary = |pts: Vec<proto::Point3D>| proto::LaneBoundary {
        point: pts,
        road_mark: Vec::new(),
        road_mark_range: Vec::new(),
        b_virtual: true,
    };
    proto::LaneGeometry {
        id: lane_geometry_id(section_id, 0),
        left_boundary: Some(boundary(points.clone())),
        right_boundary: Some(boundary(points.clone())),
        center_boundary: Some(boundary(points)),
    }
}

/// Build a lane's boundary geometry. `left_boundary`/`right_boundary` are set to
/// the lane's two edges so the importer recovers the width from their distance;
/// road marks are attached to the boundary the importer reads for this side
/// (`id>0`→right, `id<0`→left).
fn build_lane_geometry(
    road: &Road,
    section: &LaneSection,
    lane: &Lane,
    section_id: &str,
) -> proto::LaneGeometry {
    let outer = sample_lane_boundary(road, section.s, lane.id, GEOZ_LANE_STEP);
    let inner_id = lane.id - lane.id.signum();
    // Inner edge: adjacent lane's outer edge, or the reference line (id 0).
    let inner = sample_lane_boundary(road, section.s, inner_id, GEOZ_LANE_STEP);

    let outer_points: Vec<proto::Point3D> = outer.iter().map(boundary_to_point).collect();
    let inner_points: Vec<proto::Point3D> = inner.iter().map(boundary_to_point).collect();
    // Lane centre-line = midpoint between the two edges (virtual, no marks).
    let center_points: Vec<proto::Point3D> = outer
        .iter()
        .zip(inner.iter())
        .map(|(o, i)| proto::Point3D {
            x: (o.x + i.x) / 2.0,
            y: (o.y + i.y) / 2.0,
            z: (o.z + i.z) / 2.0,
        })
        .collect();

    let marks: Vec<proto::RoadMark> = lane.road_marks.iter().map(build_road_mark).collect();

    // For a left lane (id>0) the outer edge is on the +t (left) side; for a
    // right lane the outer edge is on the -t (right) side.
    let (left_points, right_points) = if lane.id > 0 {
        (outer_points, inner_points)
    } else {
        (inner_points, outer_points)
    };

    let mark_on_right = lane.id > 0;
    let left_boundary = proto::LaneBoundary {
        point: left_points,
        road_mark: if mark_on_right {
            Vec::new()
        } else {
            marks.clone()
        },
        road_mark_range: Vec::new(),
        b_virtual: false,
    };
    let right_boundary = proto::LaneBoundary {
        point: right_points,
        road_mark: if mark_on_right { marks } else { Vec::new() },
        road_mark_range: Vec::new(),
        b_virtual: false,
    };
    let center_boundary = proto::LaneBoundary {
        point: center_points,
        road_mark: Vec::new(),
        road_mark_range: Vec::new(),
        b_virtual: true,
    };

    proto::LaneGeometry {
        id: lane_geometry_id(section_id, lane.id),
        left_boundary: Some(left_boundary),
        right_boundary: Some(right_boundary),
        center_boundary: Some(center_boundary),
    }
}

fn boundary_to_point(point: &we_core::lane_ops::LaneBoundaryPoint) -> proto::Point3D {
    proto::Point3D {
        x: point.x,
        y: point.y,
        z: point.z,
    }
}

/// Road heading (radians) at station `s`, or 0 if the road has no geometry.
fn road_heading_at(road: &Road, s: f64) -> f64 {
    evaluate_road_at_s(road, s).map(|p| p.hdg).unwrap_or(0.0)
}

/// Convert a road-frame `(s, t, z_offset)` position to world `(x, y, z)` using
/// the road reference line + elevation profile. Falls back to the raw values
/// when the road has no geometry.
fn road_frame_to_world(road: &Road, s: f64, t: f64, z_offset: f64) -> (f64, f64, f64) {
    match evaluate_road_at_s(road, s) {
        Some(ref_pt) => {
            let elevation = evaluate_elevation(&road.elevation_profile, s);
            let (x, y, _) = offset_point(&ref_pt, t, elevation);
            (x, y, elevation + z_offset)
        }
        None => (s, t, z_offset),
    }
}

/// Convert one object corner to world coordinates, honouring the corner frame.
fn corner_to_world(
    road: &Road,
    object: &RoadObject,
    corner: &we_core::model::Point3D,
) -> proto::Point3D {
    let (cs, ct, cz) = match object.corner_type {
        we_core::model::CornerType::Road => (corner.x, corner.y, corner.z),
        we_core::model::CornerType::Local => {
            // (u, v) rotated by the object heading, offset from the object anchor.
            let (ch, sh) = (object.hdg.cos(), object.hdg.sin());
            let ds = corner.x * ch - corner.y * sh;
            let dt = corner.x * sh + corner.y * ch;
            (
                object.position.x + ds,
                object.position.y + dt,
                object.position.z + corner.z,
            )
        }
    };
    let (x, y, z) = road_frame_to_world(road, cs, ct, cz);
    proto::Point3D { x, y, z }
}

// ============================================================================
// Objects & signals
// ============================================================================

fn build_object(object: &RoadObject, road: &Road) -> proto::Object {
    // Preserve road-frame corners so our own importer can reconstruct them
    // losslessly even though `boundary_knots` carries world coordinates.
    let corners_road_frame = object
        .corners
        .iter()
        .map(|c| format!("{},{},{}", c.x, c.y, c.z))
        .collect::<Vec<_>>()
        .join(";");

    let mut user_data = vec![
        prop("s", object.position.x),
        prop("t", object.position.y),
        prop("zOffset", object.position.z),
        prop("orientation", object.orientation),
        prop("hdg", object.hdg),
        prop("pitch", object.pitch),
        prop("roll", object.roll),
        prop("width", object.width),
        prop("height", object.height),
        prop("length", object.length),
        proto::Propertie {
            name: "cornerType".to_string(),
            value: match object.corner_type {
                we_core::model::CornerType::Road => "Road".to_string(),
                we_core::model::CornerType::Local => "Local".to_string(),
            },
        },
        proto::Propertie {
            name: "fromObjectRef".to_string(),
            value: object.from_object_ref.to_string(),
        },
        proto::Propertie {
            name: "name".to_string(),
            value: object.name.clone(),
        },
        proto::Propertie {
            name: "cornersRoadFrame".to_string(),
            value: corners_road_frame,
        },
    ];
    if let Some(validity) = &object.validity {
        user_data.push(prop("validityFromLane", validity.from_lane as f64));
        user_data.push(prop("validityToLane", validity.to_lane as f64));
    }

    let (wx, wy, wz) =
        road_frame_to_world(road, object.position.x, object.position.y, object.position.z);
    let theta = road_heading_at(road, object.position.x) + object.hdg;

    proto::Object {
        id: object.id.clone(),
        r#type: object_type_to_string(&object.object_type),
        sub_type: String::new(),
        road_id: road.id.clone(),
        // World position + orientation/up vectors (SimOne-compatible); road-frame
        // values are mirrored into userDataList above for our own round-trip.
        pt: Some(proto::Point3D {
            x: wx,
            y: wy,
            z: wz,
        }),
        heading: Some(proto::Point3D {
            x: theta.cos(),
            y: theta.sin(),
            z: 0.0,
        }),
        up: Some(proto::Point3D {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        }),
        boundary_knots: object
            .corners
            .iter()
            .map(|c| corner_to_world(road, object, c))
            .collect(),
        user_data_list: user_data,
    }
}

fn build_signal(signal: &Signal, road: &Road) -> proto::Signal {
    let user_data = vec![
        prop("s", signal.s),
        prop("t", signal.t),
        prop("zOffset", signal.z_offset),
        prop("h_offset", signal.h_offset),
        proto::Propertie {
            name: "orientation".to_string(),
            value: signal.orientation.clone(),
        },
        proto::Propertie {
            name: "name".to_string(),
            value: signal.name.clone(),
        },
        proto::Propertie {
            name: "country".to_string(),
            value: signal.country.clone(),
        },
        proto::Propertie {
            name: "subtype".to_string(),
            value: signal.signal_subtype.clone(),
        },
    ];

    let (wx, wy, wz) = road_frame_to_world(road, signal.s, signal.t, signal.z_offset);
    let theta = road_heading_at(road, signal.s) + signal.h_offset;

    proto::Signal {
        id: signal.id.clone(),
        r#type: signal.signal_type.clone(),
        sub_type: signal.signal_subtype.clone(),
        road_id: road.id.clone(),
        // World position + heading vector (SimOne-compatible); road-frame values
        // are mirrored into userDataList for our own round-trip.
        pt: Some(proto::Point3D {
            x: wx,
            y: wy,
            z: wz,
        }),
        heading: Some(proto::Point3D {
            x: theta.cos(),
            y: theta.sin(),
            z: 0.0,
        }),
        value: signal.value.clone().unwrap_or_default(),
        unit: signal.unit.clone(),
        dynamic: signal.is_dynamic,
        width: signal.width,
        length: 0.0,
        height: signal.height,
        validities: signal
            .validities
            .iter()
            .map(|v| proto::SignalValidity {
                road_id: road.id.clone(),
                from_lane_id: v.from_lane.to_string(),
                to_lane_id: v.to_lane.to_string(),
                stop_line_ids: Vec::new(),
                crosswalk_ids: Vec::new(),
            })
            .collect(),
        user_data_list: user_data,
    }
}

fn build_road_mark(mark: &RoadMark) -> proto::RoadMark {
    proto::RoadMark {
        offset: mark.s_offset,
        length: 0.0,
        mark_type: road_mark_type_to_proto(mark.mark_type) as i32,
        mark_color: road_mark_color_to_proto(mark.color) as i32,
        mark_weight: road_mark_weight_to_proto(mark.weight) as i32,
        width: mark.width,
        user_data_list: Vec::new(),
    }
}

// ============================================================================
// Enum + helper mappings
// ============================================================================

fn lane_type_to_proto(lane_type: LaneType) -> proto::lane_header::LaneType {
    use proto::lane_header::LaneType as P;
    match lane_type {
        LaneType::Driving | LaneType::Bus | LaneType::Taxi | LaneType::HOV => P::Driving,
        LaneType::Stop => P::Stop,
        LaneType::Shoulder => P::Shoulder,
        LaneType::Biking => P::Biking,
        LaneType::Sidewalk => P::Sidewalk,
        LaneType::Border | LaneType::Curb => P::Border,
        LaneType::Restricted => P::Restricted,
        LaneType::Parking => P::Parking,
        LaneType::Bidirectional => P::Bidirectional,
        LaneType::Median => P::Median,
        LaneType::Special1 => P::Special1,
        LaneType::Special2 => P::Special2,
        LaneType::Special3 => P::Special3,
        LaneType::RoadWorks => P::RoadWorks,
        LaneType::Tram => P::Tram,
        LaneType::Rail => P::Rail,
        LaneType::Entry => P::Entry,
        LaneType::Exit => P::Exit,
        LaneType::OffRamp => P::OffRamp,
        LaneType::OnRamp | LaneType::ConnectingRamp => P::OnRamp,
        LaneType::None => P::None,
    }
}

fn road_mark_type_to_proto(mark_type: RoadMarkType) -> proto::road_mark::LaneMarkType {
    use proto::road_mark::LaneMarkType as P;
    match mark_type {
        RoadMarkType::Solid | RoadMarkType::StopLine => P::TypeSolid,
        RoadMarkType::Broken => P::TypeBroken,
        RoadMarkType::SolidSolid => P::TypeSolidSolid,
        RoadMarkType::SolidBroken => P::TypeSolidBroken,
        RoadMarkType::BrokenSolid => P::TypeBrokenSolid,
        RoadMarkType::BottsDots => P::TypeBottsDots,
        RoadMarkType::Grass => P::TypeGrass,
        RoadMarkType::Curb => P::TypeCurb,
        RoadMarkType::Custom => P::Custom,
        RoadMarkType::None => P::TypeNone,
    }
}

fn road_mark_color_to_proto(color: RoadMarkColor) -> proto::road_mark::LaneMarkColor {
    use proto::road_mark::LaneMarkColor as P;
    match color {
        RoadMarkColor::Standard => P::ColorStandard,
        RoadMarkColor::Blue => P::ColorBlue,
        RoadMarkColor::Green => P::ColorGreen,
        RoadMarkColor::Red => P::ColorRed,
        RoadMarkColor::White => P::ColorWhite,
        RoadMarkColor::Yellow => P::ColorYellow,
        RoadMarkColor::Orange | RoadMarkColor::Violet => P::ColorOrange,
    }
}

fn road_mark_weight_to_proto(weight: RoadMarkWeight) -> proto::road_mark::LaneMarkWeight {
    use proto::road_mark::LaneMarkWeight as P;
    match weight {
        RoadMarkWeight::Standard => P::WeightStandard,
        RoadMarkWeight::Bold => P::WeightBold,
    }
}

/// Serialize an [`ObjectType`] to the proto `type` string. Built-in variants use
/// their PascalCase name; custom objects use their inner string.
fn object_type_to_string(object_type: &ObjectType) -> String {
    match object_type {
        ObjectType::Sign => "Sign",
        ObjectType::Guardrail => "Guardrail",
        ObjectType::Barrier => "Barrier",
        ObjectType::Curb => "Curb",
        ObjectType::Wall => "Wall",
        ObjectType::Pillar => "Pillar",
        ObjectType::TrafficCone => "TrafficCone",
        ObjectType::ParkingSpace => "ParkingSpace",
        ObjectType::Crosswalk => "Crosswalk",
        ObjectType::StopLine => "StopLine",
        ObjectType::CrossHatchArea => "CrossHatchArea",
        ObjectType::WovenArea => "WovenArea",
        ObjectType::ForwardWaitingArea => "ForwardWaitingArea",
        ObjectType::TurnLeftWaitingArea => "TurnLeftWaitingArea",
        ObjectType::SlowDownToYieldLine => "SlowDownToYieldLine",
        ObjectType::StopToYieldLine => "StopToYieldLine",
        ObjectType::SimpleSignalPole => "SimpleSignalPole",
        ObjectType::TrafficLightPole => "TrafficLightPole",
        ObjectType::StreetLightPole => "StreetLightPole",
        ObjectType::SignGantry => "SignGantry",
        ObjectType::LTypeSignalPole => "LTypeSignalPole",
        ObjectType::Custom(name) => return name.clone(),
    }
    .to_string()
}

fn lane_geometry_id(section_id: &str, lane_id: i32) -> String {
    format!("{section_id}_{lane_id}")
}

fn prop(name: &str, value: f64) -> proto::Propertie {
    proto::Propertie {
        name: name.to_string(),
        value: value.to_string(),
    }
}

/// Sanitize a project name into a safe ZIP entry stem.
fn sanitize_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "worldeditor".to_string()
    } else {
        cleaned
    }
}

/// Sanitize `name` into a safe ZIP entry stem, falling back to `fallback`
/// (also sanitized) when `name` is empty or reduces to nothing usable.
fn sanitize_stem_or(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        sanitize_stem(fallback)
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use we_core::model::{
        CornerType, Junction, JunctionConnection, JunctionLaneLink, Point3D, Project, Validity,
    };

    /// Build a small project: one straight road (one lane section, one driving
    /// lane each side), one crosswalk object, one parking space, one signal,
    /// and one junction connection.
    fn sample_project() -> Project {
        let plan_view = vec![
            we_core::model::Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: we_core::model::GeometryType::Line,
            },
            we_core::model::Geometry {
                s: 10.0,
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: we_core::model::GeometryType::Line,
            },
        ];
        let mut road = Road::from_centerline_with_width("road-1", plan_view, 3.5);
        road.name = "Main".to_string();

        road.objects.push(RoadObject {
            id: "cw-1".to_string(),
            object_type: ObjectType::Crosswalk,
            name: "crosswalk".to_string(),
            position: Point3D::new(5.0, 0.0, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 4.0,
            height: 0.0,
            length: 3.0,
            corners: vec![
                Point3D::new(4.0, -1.75, 0.0),
                Point3D::new(6.0, -1.75, 0.0),
                Point3D::new(6.0, 1.75, 0.0),
                Point3D::new(4.0, 1.75, 0.0),
            ],
            corner_type: CornerType::Road,
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        });
        road.objects.push(RoadObject {
            id: "ps-1".to_string(),
            object_type: ObjectType::ParkingSpace,
            name: "parking".to_string(),
            position: Point3D::new(8.0, -3.0, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 2.5,
            height: 0.0,
            length: 5.0,
            corners: vec![
                Point3D::new(6.0, -4.0, 0.0),
                Point3D::new(11.0, -4.0, 0.0),
                Point3D::new(11.0, -2.0, 0.0),
                Point3D::new(6.0, -2.0, 0.0),
            ],
            corner_type: CornerType::Road,
            validity: Some(Validity {
                from_lane: -1,
                to_lane: -1,
            }),
            from_object_ref: false,
            user_data: vec![],
        });

        road.signals.push(Signal {
            id: "sig-1".to_string(),
            name: "light".to_string(),
            s: 5.0,
            t: -2.0,
            z_offset: 2.0,
            h_offset: 0.0,
            width: 0.3,
            height: 1.0,
            signal_type: "1000001".to_string(),
            signal_subtype: "-1".to_string(),
            value: None,
            orientation: "+".to_string(),
            is_dynamic: true,
            country: "OpenDRIVE".to_string(),
            unit: String::new(),
            validities: vec![Validity {
                from_lane: -1,
                to_lane: -1,
            }],
        });

        let junction = Junction {
            id: "j-1".to_string(),
            name: "Junction 1".to_string(),
            connections: vec![JunctionConnection {
                id: "c-0".to_string(),
                incoming_road: "road-1".to_string(),
                connecting_road: "road-1".to_string(),
                contact_point: ContactPoint::Start,
                lane_links: vec![JunctionLaneLink { from: -1, to: -1 }],
            }],
        };

        Project {
            name: "TestMap".to_string(),
            roads: vec![road],
            junctions: vec![junction],
            ..Default::default()
        }
    }

    /// Extract a named class of entries from the exported ZIP.
    fn read_entries(bytes: &[u8], ext: &str) -> Vec<Vec<u8>> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("valid zip");
        let mut out = Vec::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            if file.name().to_lowercase().ends_with(ext) {
                let mut buf = Vec::new();
                file.read_to_end(&mut buf).unwrap();
                out.push(buf);
            }
        }
        out
    }

    /// Collect all ZIP entry names.
    fn entry_names(bytes: &[u8]) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("valid zip");
        (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn test_export_produces_readable_zip_with_topo_and_geo() {
        let project = sample_project();
        let bytes = export_to_geoz(&project).expect("export succeeds");

        let topo_entries = read_entries(&bytes, ".topo");
        let geo_entries = read_entries(&bytes, ".geo");
        assert_eq!(topo_entries.len(), 1, "one topo file");
        assert_eq!(geo_entries.len(), 1, "one geo file per road");

        // The .geo entry is named after the road id (no `road_` prefix).
        let names = entry_names(&bytes);
        assert!(
            names.iter().any(|n| n == "road-1.geo"),
            "expected road-1.geo entry, got {names:?}"
        );
    }

    #[test]
    fn test_topo_roundtrip_structure() {
        let project = sample_project();
        let bytes = export_to_geoz(&project).expect("export");
        let topo_bytes = &read_entries(&bytes, ".topo")[0];
        let topo = proto::TopoMapFile::decode(topo_bytes.as_slice()).expect("decode topo");

        assert_eq!(topo.header.as_ref().unwrap().name, "TestMap");
        assert_eq!(topo.roads.len(), 1);
        let road = &topo.roads[0];
        assert_eq!(road.header.as_ref().unwrap().id, "road-1");
        assert_eq!(road.header.as_ref().unwrap().length, 20.0);

        // One LEFT + one RIGHT RoadSection sharing the same section index.
        assert_eq!(road.road_sections.len(), 2);
        assert_eq!(
            road.road_sections[0].section_direction_type,
            proto::road_section::Type::LeftSection as i32
        );
        assert_eq!(
            road.road_sections[1].section_direction_type,
            proto::road_section::Type::RightSection as i32
        );

        // Objects: crosswalk in road_objects, parking space in road_parking_space.
        assert_eq!(road.road_objects.len(), 1);
        assert_eq!(road.road_objects[0].r#type, "Crosswalk");
        assert_eq!(road.road_objects[0].boundary_knots.len(), 4);
        assert_eq!(road.road_parking_space.len(), 1);

        // Signal with validity.
        assert_eq!(road.road_signal.len(), 1);
        assert_eq!(road.road_signal[0].validities.len(), 1);

        // Junction with one connection.
        assert_eq!(topo.junctions.len(), 1);
        assert_eq!(topo.junctions[0].junction_links.len(), 1);
        assert_eq!(
            topo.junctions[0].junction_links[0].junction_lane_link[0].from,
            "-1"
        );
    }

    #[test]
    fn test_geo_roundtrip_center_line() {
        let project = sample_project();
        let bytes = export_to_geoz(&project).expect("export");
        let geo_bytes = &read_entries(&bytes, ".geo")[0];
        let tile = proto::TileRoadFile::decode(geo_bytes.as_slice()).expect("decode geo");

        let geometry = tile.road_geometry.expect("has road_geometry");
        assert_eq!(geometry.id, "road-1");
        // Road centre-line is written to `center_line` (reference_line stays empty).
        assert!(geometry.reference_line.is_none());
        let center = geometry.center_line.expect("center line");
        // A 20 m straight sampled adaptively still yields ≥ 2 points.
        assert!(center.point.len() >= 2);
        // Endpoints match the plan view (0,0) → (20,0).
        assert!((center.point.first().unwrap().x - 0.0).abs() < 1e-6);
        assert!((center.point.last().unwrap().x - 20.0).abs() < 1e-6);

        // Two surface lanes (id +1 / -1) plus one virtual centre lane = 3
        // lane geometries, each with a centre boundary.
        assert_eq!(geometry.lane_geometrys.len(), 3);
        assert!(geometry.lane_geometrys[0].center_boundary.is_some());
    }

    #[test]
    fn test_center_line_lane_present() {
        let project = sample_project();
        let bytes = export_to_geoz(&project).expect("export");

        // Topo: each section starts with a virtual CENTER_LINE lane `<sid>_0`.
        let topo = proto::TopoMapFile::decode(read_entries(&bytes, ".topo")[0].as_slice())
            .expect("decode topo");
        let road = &topo.roads[0];
        for section in &road.road_sections {
            let center = section.lanes.first().expect("section has a centre lane");
            let header = center.header.as_ref().unwrap();
            assert_eq!(
                header.virtual_type,
                proto::lane_header::LaneVirtualType::CenterLine as i32,
                "first lane must be the CENTER_LINE virtual lane"
            );
            assert_eq!(header.id, "road-1_0_0");
            assert_eq!(header.name, header.id, "lane name must equal its id");
        }

        // Geo: a matching lane_geometry `road-1_0_0` exists.
        let tile = proto::TileRoadFile::decode(read_entries(&bytes, ".geo")[0].as_slice())
            .expect("decode geo");
        let geometry = tile.road_geometry.unwrap();
        assert!(
            geometry.lane_geometrys.iter().any(|g| g.id == "road-1_0_0"),
            "geo must contain the centre lane geometry"
        );
    }

    /// The `.proto` schema under `crates/we-io/proto/` must stay byte-identical
    /// (ignoring line endings) to the frontend copy consumed by the GeoZ
    /// importer, so both encoder and decoder share one source of truth.
    #[test]
    fn test_proto_schema_matches_frontend() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let rust_dir = manifest.join("proto");
        let frontend_dir = manifest.join("../../frontend/src/plugins/io/geoz/proto");

        let files = [
            "map.proto",
            "map_geometry.proto",
            "map_object.proto",
            "map_lane_geo.proto",
            "map_lane_topo.proto",
            "map_junction_geo.proto",
            "map_junction_topo.proto",
            "map_road_geo.proto",
            "map_road_topo.proto",
        ];

        for file in files {
            let rust = std::fs::read_to_string(rust_dir.join(file))
                .unwrap_or_else(|e| panic!("read we-io/proto/{file}: {e}"));
            let frontend = std::fs::read_to_string(frontend_dir.join(file))
                .unwrap_or_else(|e| panic!("read frontend proto/{file}: {e}"));
            assert_eq!(
                rust.replace("\r\n", "\n"),
                frontend.replace("\r\n", "\n"),
                "proto schema drift in {file}: crates/we-io/proto and frontend copy differ"
            );
        }
    }
}
