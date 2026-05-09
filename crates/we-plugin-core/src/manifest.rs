//! Plugin manifest parsing

use crate::error::{PluginError, PluginResult};
use serde::Deserialize;
use std::path::Path;

/// Plugin manifest structure (manifest.json)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// Unique plugin identifier (kebab-case)
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Semantic version string
    pub version: String,

    /// Optional description
    #[serde(default)]
    pub description: Option<String>,

    /// Plugin dependencies (by ID)
    #[serde(default)]
    pub dependencies: Vec<String>,

    /// Required permissions
    #[serde(default)]
    pub permissions: Vec<String>,

    /// Entry point file path (relative to plugin directory)
    pub main: String,

    /// Optional author information
    #[serde(default)]
    pub author: Option<String>,

    /// Optional license
    #[serde(default)]
    pub license: Option<String>,

    /// Optional categories/tags
    #[serde(default)]
    pub tags: Vec<String>,
}

impl PluginManifest {
    /// Load manifest from a file path
    pub fn from_path<P: AsRef<Path>>(path: P) -> PluginResult<Self> {
        let path = path.as_ref();
        let content = std::fs::read_to_string(path).map_err(|e| {
            PluginError::InvalidManifest(
                path.display().to_string(),
                format!("Failed to read file: {e}"),
            )
        })?;
        Self::from_json(&content)
    }

    /// Parse manifest from JSON string
    pub fn from_json(json: &str) -> PluginResult<Self> {
        serde_json::from_str(json).map_err(|e| {
            PluginError::InvalidManifest("JSON".to_string(), format!("Failed to parse: {e}"))
        })
    }

    /// Validate the manifest
    pub fn validate(&self) -> PluginResult<()> {
        if self.id.is_empty() {
            return Err(PluginError::InvalidManifest(
                self.id.clone(),
                "Plugin ID cannot be empty".to_string(),
            ));
        }
        if self.name.is_empty() {
            return Err(PluginError::InvalidManifest(
                self.id.clone(),
                "Plugin name cannot be empty".to_string(),
            ));
        }
        if !Self::is_valid_version(&self.version) {
            return Err(PluginError::InvalidManifest(
                self.id.clone(),
                format!("Invalid version format: {}", self.version),
            ));
        }
        if self.main.is_empty() {
            return Err(PluginError::InvalidManifest(
                self.id.clone(),
                "Main entry point cannot be empty".to_string(),
            ));
        }
        Ok(())
    }

    /// Check if a version string is valid semver
    fn is_valid_version(version: &str) -> bool {
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() != 3 {
            return false;
        }
        parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    }
}

/// Manifest with resolved file paths
#[derive(Debug)]
pub struct ResolvedManifest {
    pub manifest: PluginManifest,
    pub plugin_dir: std::path::PathBuf,
    pub main_path: std::path::PathBuf,
}

impl ResolvedManifest {
    /// Resolve paths relative to plugin directory
    pub fn resolve(manifest: PluginManifest, plugin_dir: std::path::PathBuf) -> Self {
        let main_path = plugin_dir.join(&manifest.main);
        Self {
            manifest,
            plugin_dir,
            main_path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_manifest() {
        let json = r#"{
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.0.0",
            "description": "An example plugin",
            "main": "dist/plugin.js"
        }"#;
        let manifest = PluginManifest::from_json(json).unwrap();
        assert_eq!(manifest.id, "example-plugin");
        assert_eq!(manifest.version, "1.0.0");
    }

    #[test]
    fn test_validate_version() {
        assert!(
            PluginManifest::from_json(r#"{"id":"p","name":"P","version":"1.2.3","main":"a.js"}"#)
                .unwrap()
                .validate()
                .is_ok()
        );
        assert!(
            PluginManifest::from_json(r#"{"id":"p","name":"P","version":"1.2","main":"a.js"}"#)
                .unwrap()
                .validate()
                .is_err()
        );
    }

    #[test]
    fn test_parse_manifest_with_dependencies() {
        let json = r#"{
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.0.0",
            "dependencies": ["core-plugin", "render-plugin"],
            "main": "dist/plugin.js"
        }"#;
        let manifest = PluginManifest::from_json(json).unwrap();

        assert_eq!(manifest.dependencies, vec!["core-plugin", "render-plugin"]);
    }

    #[test]
    fn test_parse_manifest_with_permissions() {
        let json = r#"{
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.0.0",
            "permissions": ["filesystem:read", "project:write"],
            "main": "dist/plugin.js"
        }"#;
        let manifest = PluginManifest::from_json(json).unwrap();

        assert_eq!(
            manifest.permissions,
            vec!["filesystem:read", "project:write"]
        );
    }

    #[test]
    fn test_parse_manifest_with_tags() {
        let json = r#"{
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.0.0",
            "tags": ["rendering", "utility"],
            "main": "dist/plugin.js"
        }"#;
        let manifest = PluginManifest::from_json(json).unwrap();

        assert_eq!(manifest.tags, vec!["rendering", "utility"]);
    }

    #[test]
    fn test_parse_manifest_minimal() {
        let manifest = PluginManifest::from_json(
            r#"{"id":"example-plugin","name":"Example Plugin","version":"1.0.0","main":"plugin.js"}"#,
        )
        .unwrap();

        assert_eq!(manifest.id, "example-plugin");
        assert_eq!(manifest.name, "Example Plugin");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(manifest.main, "plugin.js");
        assert!(manifest.description.is_none());
        assert!(manifest.author.is_none());
        assert!(manifest.license.is_none());
        assert!(manifest.dependencies.is_empty());
        assert!(manifest.permissions.is_empty());
        assert!(manifest.tags.is_empty());
    }

    #[test]
    fn test_parse_invalid_json() {
        let error = PluginManifest::from_json("{").unwrap_err();

        assert!(matches!(
            error,
            PluginError::InvalidManifest(source, message)
                if source == "JSON" && message.contains("Failed to parse")
        ));
    }

    #[test]
    fn test_validate_empty_id() {
        let manifest = PluginManifest::from_json(
            r#"{"id":"","name":"Example Plugin","version":"1.0.0","main":"plugin.js"}"#,
        )
        .unwrap();

        assert!(matches!(
            manifest.validate(),
            Err(PluginError::InvalidManifest(id, message))
                if id.is_empty() && message == "Plugin ID cannot be empty"
        ));
    }

    #[test]
    fn test_validate_empty_name() {
        let manifest = PluginManifest::from_json(
            r#"{"id":"example-plugin","name":"","version":"1.0.0","main":"plugin.js"}"#,
        )
        .unwrap();

        assert!(matches!(
            manifest.validate(),
            Err(PluginError::InvalidManifest(id, message))
                if id == "example-plugin" && message == "Plugin name cannot be empty"
        ));
    }

    #[test]
    fn test_validate_empty_main() {
        let manifest = PluginManifest::from_json(
            r#"{"id":"example-plugin","name":"Example Plugin","version":"1.0.0","main":""}"#,
        )
        .unwrap();

        assert!(matches!(
            manifest.validate(),
            Err(PluginError::InvalidManifest(id, message))
                if id == "example-plugin" && message == "Main entry point cannot be empty"
        ));
    }

    #[test]
    fn test_validate_invalid_version_format() {
        for version in ["", "1", "1.0", "1.0.0.0", "1.0.a", "v1.0.0", "1..0"] {
            let manifest = PluginManifest::from_json(&format!(
                r#"{{"id":"example-plugin","name":"Example Plugin","version":"{version}","main":"plugin.js"}}"#,
            ))
            .unwrap();

            assert!(matches!(
                manifest.validate(),
                Err(PluginError::InvalidManifest(id, message))
                    if id == "example-plugin"
                        && message == format!("Invalid version format: {version}")
            ));
        }
    }

    #[test]
    fn test_resolved_manifest() {
        let manifest = PluginManifest::from_json(
            r#"{"id":"example-plugin","name":"Example Plugin","version":"1.0.0","main":"dist/plugin.js"}"#,
        )
        .unwrap();
        let plugin_dir = std::path::PathBuf::from("plugins").join("example-plugin");
        let resolved = ResolvedManifest::resolve(manifest, plugin_dir.clone());

        assert_eq!(resolved.manifest.id, "example-plugin");
        assert_eq!(resolved.plugin_dir, plugin_dir);
        assert_eq!(
            resolved.main_path,
            resolved.plugin_dir.join("dist/plugin.js")
        );
    }
}
