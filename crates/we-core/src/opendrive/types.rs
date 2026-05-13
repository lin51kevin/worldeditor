//! OpenDRIVE-specific public types.

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
