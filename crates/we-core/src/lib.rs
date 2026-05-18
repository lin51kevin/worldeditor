pub mod elevation;
pub mod geometry;
pub mod gis;
pub mod junction_area;
pub mod junction_polygon;
pub mod lane_ops;
pub mod lanelet2;
pub mod math;
pub mod measurement;
pub mod model;
pub mod opendrive;
pub mod osm_export;
pub mod picking;
pub mod road_ops;
pub mod routing;
pub mod serde_helpers;
pub mod snapping;
pub mod spatial_index;
pub mod spline;
pub mod topology;

/// WorldEditor core version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
