//! Plugin trait definition

use crate::context::PluginContext;
use crate::error::PluginResult;

/// Core trait that all editor plugins must implement.
///
/// Plugins are loaded dynamically at runtime and can provide:
/// - Custom commands
/// - Renderers
/// - Menu items
/// - Extended functionality
///
/// # Safety
/// Implementors must be Send + Sync to allow safe sharing across threads.
pub trait EditorPlugin: Send + Sync {
    /// Unique identifier for this plugin (kebab-case recommended)
    fn id(&self) -> &str;

    /// Human-readable name for display in UI
    fn name(&self) -> &str;

    /// Semantic version string (e.g., "1.0.0")
    fn version(&self) -> &str;

    /// List of plugin IDs this plugin depends on
    fn dependencies(&self) -> &[&str] {
        &[]
    }

    /// Called when the plugin is loaded and ready to initialize
    ///
    /// Use this to register commands, renderers, menu items, etc.
    /// This is called AFTER the plugin binary is loaded but before
    /// it becomes visible to other plugins or the UI.
    fn initialize(&mut self, ctx: &PluginContext) -> PluginResult<()>;

    /// Called when the plugin is being unloaded
    ///
    /// Perform cleanup here: release resources, unregister items, etc.
    /// After this returns, the plugin will be unloaded from memory.
    fn shutdown(&mut self) {}

    /// Optional description of what this plugin does
    fn description(&self) -> Option<&str> {
        None
    }

    /// Optional list of permissions this plugin requires
    fn permissions(&self) -> &[&str] {
        &[]
    }
}

// WASM export helpers for wasm-bindgen
#[cfg(target_arch = "wasm32")]
pub mod wasm_support {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// Wrapper for exposing EditorPlugin to WASM
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(catch)]
        pub fn plugin_init(ctx: &PluginContext) -> Result<(), JsValue>;

        #[wasm_bindgen(catch)]
        pub fn plugin_shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{Command, CoreApi, MenuItem, RenderPlugin};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct MockPlugin {
        init_called: Arc<AtomicBool>,
        shutdown_called: Arc<AtomicBool>,
    }

    impl EditorPlugin for MockPlugin {
        fn id(&self) -> &str {
            "mock-plugin"
        }

        fn name(&self) -> &str {
            "Mock Plugin"
        }

        fn version(&self) -> &str {
            "1.0.0"
        }

        fn initialize(&mut self, _ctx: &PluginContext) -> PluginResult<()> {
            self.init_called.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn shutdown(&mut self) {
            self.shutdown_called.store(true, Ordering::SeqCst);
        }
    }

    struct DefaultMethodsPlugin {
        shutdown_called: Arc<AtomicBool>,
    }

    impl EditorPlugin for DefaultMethodsPlugin {
        fn id(&self) -> &str {
            "default-plugin"
        }

        fn name(&self) -> &str {
            "Default Plugin"
        }

        fn version(&self) -> &str {
            "1.0.0"
        }

        fn initialize(&mut self, _ctx: &PluginContext) -> PluginResult<()> {
            Ok(())
        }
    }

    struct TestCoreApi;

    impl CoreApi for TestCoreApi {
        fn version(&self) -> &str {
            "1.0.0"
        }

        fn project_path(&self) -> Option<&str> {
            None
        }

        fn execute_command(&self, _command_id: &str) -> Result<(), String> {
            Ok(())
        }
    }

    static TEST_CORE_API: TestCoreApi = TestCoreApi;

    fn test_context() -> PluginContext {
        PluginContext::new(
            |_id: String, _command: Command| {},
            |_renderer: &dyn RenderPlugin| {},
            |_menu_item: MenuItem| {},
            || &TEST_CORE_API,
        )
    }

    #[test]
    fn test_editor_plugin_initialize_and_shutdown() {
        let init_called = Arc::new(AtomicBool::new(false));
        let shutdown_called = Arc::new(AtomicBool::new(false));
        let mut plugin = MockPlugin {
            init_called: Arc::clone(&init_called),
            shutdown_called: Arc::clone(&shutdown_called),
        };
        let ctx = test_context();

        plugin.initialize(&ctx).unwrap();
        plugin.shutdown();

        assert!(init_called.load(Ordering::SeqCst));
        assert!(shutdown_called.load(Ordering::SeqCst));
    }

    #[test]
    fn test_editor_plugin_default_methods() {
        let shutdown_called = Arc::new(AtomicBool::new(false));
        let mut plugin = DefaultMethodsPlugin {
            shutdown_called: Arc::clone(&shutdown_called),
        };

        assert!(plugin.dependencies().is_empty());
        assert_eq!(plugin.description(), None);
        assert!(plugin.permissions().is_empty());

        plugin.shutdown();

        assert!(!plugin.shutdown_called.load(Ordering::SeqCst));
    }
}
