//! WorldEditor WASM entry point.
//!
//! Exports we-core + we-service functions to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;

// Host (rnk-next embed) needs only `opendrive`, `render` (which uses `picking`)
// and `pointcloud`. The remaining editor modules are gated behind the
// `extra-modules` feature (off by default) so the default wasm build — the one
// vendored into the rnk-next embed — omits their exports, shrinking both the
// wasm binary and the wasm-bindgen glue JS. Enable `extra-modules` for the full
// desktop editor build.
#[cfg(feature = "extra-modules")]
pub mod elevation;
#[cfg(feature = "extra-modules")]
pub mod gis;
#[cfg(feature = "extra-modules")]
pub mod gis_ext;
#[cfg(feature = "extra-modules")]
pub mod io;
#[cfg(feature = "extra-modules")]
pub mod junction_ops;
#[cfg(feature = "extra-modules")]
pub mod measure;
pub mod opendrive;
pub mod picking;
pub mod pointcloud;
pub mod render;
#[cfg(feature = "extra-modules")]
pub mod spline;
#[cfg(feature = "extra-modules")]
pub mod topology;
#[cfg(feature = "extra-modules")]
pub mod validation;

// Set up better panic messages in the browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Info).unwrap_or(());
    log::info!("WorldEditor WASM initialized (v{})", we_core::VERSION);
}

#[cfg(test)]
mod tests {
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_version() {
        let v = crate::opendrive::version();
        assert!(!v.is_empty());
    }

    #[wasm_bindgen_test]
    fn test_parse_opendrive() {
        let xml =
            r#"<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="6"/></OpenDRIVE>"#;
        let result = crate::opendrive::parse_opendrive(xml);
        assert!(result.is_ok());
    }
}
