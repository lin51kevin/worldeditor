//! Build script: generate Rust types for the GeoZ (`rt.hdmap`) protobuf schema.
//!
//! Uses `protox` (a pure-Rust protobuf compiler) so no external `protoc` binary
//! is required, then feeds the resulting `FileDescriptorSet` to `prost-build`.
//! The generated module is written to `$OUT_DIR/rt.hdmap.rs` and included by
//! `crate::geoz_export`.

use std::path::PathBuf;

fn main() {
    let proto_dir = PathBuf::from("proto");

    // Leaf-to-root order does not matter for protox; list every schema file so
    // all messages (objects, lanes, junctions, roads) are generated.
    let protos = [
        proto_dir.join("map_geometry.proto"),
        proto_dir.join("map_object.proto"),
        proto_dir.join("map_lane_geo.proto"),
        proto_dir.join("map_lane_topo.proto"),
        proto_dir.join("map_junction_geo.proto"),
        proto_dir.join("map_junction_topo.proto"),
        proto_dir.join("map_road_geo.proto"),
        proto_dir.join("map_road_topo.proto"),
        proto_dir.join("map.proto"),
    ];

    for proto in &protos {
        println!("cargo:rerun-if-changed={}", proto.display());
    }
    println!("cargo:rerun-if-changed=build.rs");

    let file_descriptors =
        protox::compile(&protos, [&proto_dir]).expect("failed to compile GeoZ .proto schema");

    let mut config = prost_build::Config::new();
    config
        .compile_fds(file_descriptors)
        .expect("failed to generate Rust types from GeoZ FileDescriptorSet");
}
