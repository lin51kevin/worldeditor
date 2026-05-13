//! WorldEditor Plugin System Core
//!
//! Provides runtime dynamic plugin loading/unloading for the editor.
//! Supports WASM-based plugins with full lifecycle management.
//!
//! # Example
//!
//! ```rust,ignore
//! use we_plugin_core::{PluginRegistry, PluginContext, EditorPlugin};
//!
//! // Create registry
//! let mut registry = PluginRegistry::new("./plugins");
//! registry.discover();
//!
//! // Create context
//! let ctx = PluginContext::new(
//!     |id, cmd| { /* register command */ },
//!     |renderer| { /* register renderer */ },
//!     |item| { /* register menu item */ },
//!     || &core_api,
//! );
//!
//! // Load a plugin
//! registry.load("my-plugin", &ctx)?;
//! ```

pub mod context;
pub mod error;
pub mod manifest;
pub mod plugin;
pub mod registry;

pub use context::{
    Command, CoreApi, ExporterContrib, ImporterContrib, MenuItem, PluginContext, RenderPlugin,
};
pub use error::{PluginError, PluginResult};
pub use manifest::PluginManifest;
pub use plugin::EditorPlugin;
pub use registry::{PluginInfo, PluginRegistry, PluginStatus, SharedPluginRegistry};

// Re-export for convenience
/// Default plugins directory name
pub const DEFAULT_PLUGINS_DIR: &str = "plugins";

/// Create a new registry with the default plugins directory
impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new(DEFAULT_PLUGINS_DIR)
    }
}
