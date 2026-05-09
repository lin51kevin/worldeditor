pub mod elevation;
pub mod geometry;
pub mod gis;
pub mod junction_area;
pub mod lane_ops;
pub mod math;
pub mod measurement;
pub mod model;
pub mod opendrive;
pub mod picking;
pub mod snapping;
pub mod spatial_index;
pub mod spline;

/// WorldEditor core version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
