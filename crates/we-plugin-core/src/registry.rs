//! Plugin registry — manages plugin lifecycle

use crate::context::PluginContext;
use crate::error::{PluginError, PluginResult};
use crate::manifest::{PluginManifest, ResolvedManifest};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

/// Loaded plugin instance
struct LoadedPlugin {
    manifest: PluginManifest,
    instance: Box<dyn crate::plugin::EditorPlugin>,
    initialized: bool,
}

/// Plugin registry — discovers, loads, and manages plugins
pub struct PluginRegistry {
    /// Plugins available on disk (id -> resolved manifest)
    discovered: HashMap<String, ResolvedManifest>,
    /// Currently loaded plugins (id -> loaded plugin)
    loaded: HashMap<String, LoadedPlugin>,
    /// Disabled plugins (id -> reason)
    disabled: HashMap<String, String>,
    /// Plugins directory path
    plugins_dir: PathBuf,
}

impl PluginRegistry {
    /// Create a new registry with the given plugins directory
    pub fn new(plugins_dir: impl Into<PathBuf>) -> Self {
        Self {
            discovered: HashMap::new(),
            loaded: HashMap::new(),
            disabled: HashMap::new(),
            plugins_dir: plugins_dir.into(),
        }
    }

    /// Set the plugins directory and scan for available plugins
    pub fn with_plugins_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.plugins_dir = dir.into();
        self.discover();
        self
    }

    /// Discover all plugins in the plugins directory
    pub fn discover(&mut self) {
        self.discovered.clear();

        let manifest_paths = self.find_manifests();
        for manifest_path in manifest_paths {
            match PluginManifest::from_path(&manifest_path) {
                Ok(manifest) => {
                    if manifest.validate().is_ok() {
                        let plugin_dir = manifest_path
                            .parent()
                            .unwrap_or(Path::new("."))
                            .to_path_buf();
                        let resolved = ResolvedManifest::resolve(manifest, plugin_dir);
                        let id = resolved.manifest.id.clone();
                        self.discovered.insert(id, resolved);
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Failed to load plugin manifest {}: {}",
                        manifest_path.display(),
                        e
                    );
                }
            }
        }

        log::info!("Discovered {} plugins", self.discovered.len());
    }

    /// Find all manifest.json files in the plugins directory
    fn find_manifests(&self) -> Vec<PathBuf> {
        let mut manifests = Vec::new();
        if !self.plugins_dir.exists() {
            return manifests;
        }

        // Scan for plugins: each subdirectory with a manifest.json
        if let Ok(entries) = std::fs::read_dir(&self.plugins_dir) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_path = path.join("manifest.json");
                    if manifest_path.exists() {
                        manifests.push(manifest_path);
                    }
                }
            }
        }

        manifests
    }

    /// List all discovered plugins (not yet loaded)
    pub fn list_discovered(&self) -> Vec<&PluginManifest> {
        self.discovered.values().map(|r| &r.manifest).collect()
    }

    /// List all loaded plugin IDs
    pub fn list_loaded(&self) -> Vec<&str> {
        self.loaded.keys().map(|s| s.as_str()).collect()
    }

    /// Get info about a specific plugin
    pub fn plugin_info(&self, id: &str) -> Option<PluginInfo> {
        if let Some(loaded) = self.loaded.get(id) {
            Some(PluginInfo {
                id: loaded.manifest.id.clone(),
                name: loaded.manifest.name.clone(),
                version: loaded.manifest.version.clone(),
                description: loaded.manifest.description.clone(),
                dependencies: loaded.manifest.dependencies.clone(),
                permissions: loaded.manifest.permissions.clone(),
                status: PluginStatus::Loaded,
            })
        } else if let Some(resolved) = self.discovered.get(id) {
            let status = self
                .disabled
                .get(id)
                .map(|reason| PluginStatus::Disabled(reason.clone()))
                .unwrap_or(PluginStatus::Available);
            Some(PluginInfo {
                id: resolved.manifest.id.clone(),
                name: resolved.manifest.name.clone(),
                version: resolved.manifest.version.clone(),
                description: resolved.manifest.description.clone(),
                dependencies: resolved.manifest.dependencies.clone(),
                permissions: resolved.manifest.permissions.clone(),
                status,
            })
        } else {
            None
        }
    }

    /// Load a plugin by ID
    pub fn load(&mut self, id: &str, ctx: &PluginContext) -> PluginResult<()> {
        // Check if already loaded
        if self.loaded.contains_key(id) {
            return Err(PluginError::AlreadyLoaded(id.to_string()));
        }

        // Check if disabled
        if let Some(reason) = self.disabled.get(id) {
            return Err(PluginError::Disabled(reason.clone()));
        }

        // Get the resolved manifest
        let resolved = self
            .discovered
            .get(id)
            .ok_or_else(|| PluginError::NotFound(id.to_string()))?;

        // Check dependencies
        self.check_dependencies(&resolved.manifest)?;

        // Load the plugin instance (placeholder - actual WASM loading would go here)
        let instance = self.create_instance(resolved)?;

        // Initialize the plugin
        let mut plugin = LoadedPlugin {
            manifest: resolved.manifest.clone(),
            instance,
            initialized: false,
        };

        plugin
            .instance
            .initialize(ctx)
            .map_err(|e| PluginError::InitFailed(id.to_string(), e.to_string()))?;

        plugin.initialized = true;
        self.loaded.insert(id.to_string(), plugin);

        log::info!("Loaded plugin: {}", id);
        Ok(())
    }

    /// Unload a plugin by ID
    pub fn unload(&mut self, id: &str) -> PluginResult<()> {
        let mut plugin = self
            .loaded
            .remove(id)
            .ok_or_else(|| PluginError::NotLoaded(id.to_string()))?;

        plugin.instance.shutdown();
        log::info!("Unloaded plugin: {}", id);
        Ok(())
    }

    /// Enable a disabled plugin
    pub fn enable(&mut self, id: &str) -> PluginResult<()> {
        if self.loaded.contains_key(id) {
            return Err(PluginError::AlreadyLoaded(id.to_string()));
        }
        if !self.discovered.contains_key(id) {
            return Err(PluginError::NotFound(id.to_string()));
        }
        self.disabled.remove(id);
        Ok(())
    }

    /// Disable a plugin
    pub fn disable(&mut self, id: &str, reason: &str) -> PluginResult<()> {
        if self.loaded.contains_key(id) {
            return Err(PluginError::AlreadyLoaded(id.to_string()));
        }
        if !self.discovered.contains_key(id) {
            return Err(PluginError::NotFound(id.to_string()));
        }
        self.disabled.insert(id.to_string(), reason.to_string());
        Ok(())
    }

    /// Check if all dependencies are loaded
    fn check_dependencies(&self, manifest: &PluginManifest) -> PluginResult<()> {
        for dep_id in &manifest.dependencies {
            if !self.loaded.contains_key(dep_id) {
                return Err(PluginError::MissingDependency(
                    dep_id.clone(),
                    manifest.id.clone(),
                ));
            }
        }
        Ok(())
    }

    /// Create a plugin instance (placeholder for WASM loading)
    fn create_instance(
        &self,
        resolved: &ResolvedManifest,
    ) -> PluginResult<Box<dyn crate::plugin::EditorPlugin>> {
        // TODO: Actual WASM loading would go here
        // For now, return an error indicating WASM support is not yet implemented
        Err(PluginError::LoadFailed(
            resolved.manifest.id.clone(),
            "WASM plugin loading not yet implemented".to_string(),
        ))
    }

    /// Reload a plugin (unload then load)
    pub fn reload(&mut self, id: &str, ctx: &PluginContext) -> PluginResult<()> {
        if self.loaded.contains_key(id) {
            self.unload(id)?;
        }
        self.load(id, ctx)
    }
}

/// Thread-safe wrapper for PluginRegistry
pub struct SharedPluginRegistry(Arc<RwLock<PluginRegistry>>);

impl SharedPluginRegistry {
    /// Create a new shared registry
    pub fn new(registry: PluginRegistry) -> Self {
        Self(Arc::new(RwLock::new(registry)))
    }

    /// Access the inner registry
    pub fn inner(&self) -> &Arc<RwLock<PluginRegistry>> {
        &self.0
    }
}

impl Default for SharedPluginRegistry {
    fn default() -> Self {
        Self::new(PluginRegistry::new("plugins"))
    }
}

/// Plugin information for UI display
#[derive(Debug, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub permissions: Vec<String>,
    pub status: PluginStatus,
}

/// Plugin status
#[derive(Debug, Clone)]
pub enum PluginStatus {
    Available,
    Loaded,
    Disabled(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_registry() -> PluginRegistry {
        let temp_dir = tempfile::tempdir().unwrap();
        PluginRegistry::new(temp_dir.path())
    }

    fn create_registry_with_plugin(manifest_json: &str) -> (tempfile::TempDir, PluginRegistry) {
        let temp_dir = tempfile::tempdir().unwrap();
        let plugin_dir = temp_dir.path().join("example-plugin");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("manifest.json"), manifest_json).unwrap();

        let mut registry = PluginRegistry::new(temp_dir.path());
        registry.discover();

        (temp_dir, registry)
    }

    #[test]
    fn test_discover_empty_dir() {
        let registry = create_test_registry();
        assert!(registry.list_discovered().is_empty());
        assert!(registry.list_loaded().is_empty());
    }

    #[test]
    fn test_plugin_info_not_found() {
        let registry = create_test_registry();
        assert!(registry.plugin_info("nonexistent").is_none());
    }

    #[test]
    fn test_enable_not_found() {
        let mut registry = create_test_registry();

        assert!(matches!(
            registry.enable("missing-plugin"),
            Err(PluginError::NotFound(id)) if id == "missing-plugin"
        ));
    }

    #[test]
    fn test_disable_not_found() {
        let mut registry = create_test_registry();

        assert!(matches!(
            registry.disable("missing-plugin", "manual disable"),
            Err(PluginError::NotFound(id)) if id == "missing-plugin"
        ));
    }

    #[test]
    fn test_unload_not_loaded() {
        let mut registry = create_test_registry();

        assert!(matches!(
            registry.unload("missing-plugin"),
            Err(PluginError::NotLoaded(id)) if id == "missing-plugin"
        ));
    }

    #[test]
    fn test_shared_plugin_registry_default() {
        let shared = SharedPluginRegistry::default();
        let registry = shared.inner().read().unwrap();

        assert_eq!(registry.plugins_dir, PathBuf::from("plugins"));
        assert!(registry.list_discovered().is_empty());
        assert!(registry.list_loaded().is_empty());
    }

    #[test]
    fn test_plugin_status_debug() {
        assert_eq!(format!("{:?}", PluginStatus::Available), "Available");
        assert_eq!(format!("{:?}", PluginStatus::Loaded), "Loaded");
        assert_eq!(
            format!("{:?}", PluginStatus::Disabled("manual disable".to_string())),
            "Disabled(\"manual disable\")"
        );
    }

    #[test]
    fn test_plugin_info_fields() {
        let manifest = r#"{
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.0.0",
            "description": "Registry test plugin",
            "dependencies": ["core-plugin", "render-plugin"],
            "permissions": ["filesystem:read"],
            "main": "dist/plugin.wasm"
        }"#;
        let (_temp_dir, registry) = create_registry_with_plugin(manifest);
        let info = registry.plugin_info("example-plugin").unwrap();

        assert_eq!(info.id, "example-plugin");
        assert_eq!(info.name, "Example Plugin");
        assert_eq!(info.version, "1.0.0");
        assert_eq!(info.description.as_deref(), Some("Registry test plugin"));
        assert_eq!(info.dependencies, vec!["core-plugin", "render-plugin"]);
        assert_eq!(info.permissions, vec!["filesystem:read"]);
        assert!(matches!(info.status, PluginStatus::Available));
    }

    #[test]
    fn test_list_loaded_empty() {
        let registry = create_test_registry();

        assert!(registry.list_loaded().is_empty());
    }
}
