//! WorldEditor WASM entry point.
//!
//! Exports we-core + we-service functions to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;

pub mod elevation;
pub mod gis;
pub mod gis_ext;
pub mod io;
pub mod junction_ops;
pub mod measure;
pub mod opendrive;
pub mod picking;
pub mod pointcloud;
pub mod render;
pub mod spline;
pub mod topology;
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
