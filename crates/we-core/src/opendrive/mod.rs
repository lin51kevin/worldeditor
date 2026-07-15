//! OpenDRIVE format parser and writer.
//!
//! Supports reading and writing `.xodr` files (OpenDRIVE 1.4–1.6).
//! Pure Rust, WASM compatible.

mod parser;
pub mod validator;
mod writer;

use crate::model::Project;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OpenDriveError {
    #[error("XML parsing error: {0}")]
    XmlError(#[from] quick_xml::Error),
    #[error("Invalid OpenDRIVE structure: {0}")]
    InvalidStructure(String),
    #[error("Unsupported OpenDRIVE version: {0}")]
    UnsupportedVersion(String),
}

/// Parse an OpenDRIVE XML string into a Project.
pub fn parse_xodr(xml: &str) -> Result<Project, OpenDriveError> {
    parser::parse(xml)
}

/// Serialize a Project to OpenDRIVE XML string.
pub fn write_xodr(project: &Project) -> Result<String, OpenDriveError> {
    writer::write(project)
}

#[cfg(test)]
mod tests;
