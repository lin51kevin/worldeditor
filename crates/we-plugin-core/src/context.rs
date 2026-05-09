//! Plugin context API — provides access to editor services

/// Command definition for plugin-registered actions
pub struct Command {
    /// Unique command identifier
    pub id: String,
    /// Display name shown in UI
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// Keyboard shortcut (e.g., "Ctrl+Shift+P")
    pub shortcut: Option<String>,
    /// Whether the command is enabled
    pub enabled: bool,
    /// Callback when command is executed
    handler: Box<dyn Fn() + Send + Sync>,
}

impl Command {
    /// Create a new command
    pub fn new<F>(id: &str, name: &str, handler: F) -> Self
    where
        F: Fn() + Send + Sync + 'static,
    {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            shortcut: None,
            enabled: true,
            handler: Box::new(handler),
        }
    }

    /// Set description
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = Some(description.to_string());
        self
    }

    /// Set keyboard shortcut
    pub fn with_shortcut(mut self, shortcut: &str) -> Self {
        self.shortcut = Some(shortcut.to_string());
        self
    }

    /// Execute the command
    pub fn execute(&self) {
        (self.handler)();
    }
}

/// Renderer trait for custom rendering plugins
pub trait RenderPlugin: Send + Sync {
    /// Unique renderer identifier
    fn id(&self) -> &str;

    /// Render a frame
    fn render(&self);

    /// Optional resize handler
    fn on_resize(&self, _width: u32, _height: u32) {}
}

/// Menu item definition
pub struct MenuItem {
    /// Unique identifier
    pub id: String,
    /// Display label
    pub label: String,
    /// Parent menu path (e.g., "File/Export")
    pub path: String,
    /// Icon identifier (optional)
    pub icon: Option<String>,
    /// Whether the item is visible
    pub visible: bool,
    /// Whether the item is enabled
    pub enabled: bool,
    handler: Box<dyn Fn() + Send + Sync>,
}

impl MenuItem {
    /// Create a new menu item
    pub fn new<F>(id: &str, label: &str, path: &str, handler: F) -> Self
    where
        F: Fn() + Send + Sync + 'static,
    {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            path: path.to_string(),
            icon: None,
            visible: true,
            enabled: true,
            handler: Box::new(handler),
        }
    }

    /// Set icon
    pub fn with_icon(mut self, icon: &str) -> Self {
        self.icon = Some(icon.to_string());
        self
    }

    /// Execute the menu action
    pub fn execute(&self) {
        (self.handler)();
    }
}

/// Core API trait for accessing editor functionality
pub trait CoreApi: Send + Sync {
    /// Get editor version
    fn version(&self) -> &str;

    /// Get current project path
    fn project_path(&self) -> Option<&str>;

    /// Execute a core command
    fn execute_command(&self, command_id: &str) -> Result<(), String>;
}

/// Context passed to plugins during initialization
///
/// Provides access to editor services and registration functions.
pub struct PluginContext {
    /// Register a command with the editor
    pub register_command: Box<dyn Fn(String, Command) + Send + Sync>,
    /// Register a renderer
    #[allow(clippy::type_complexity)]
    pub register_renderer: Box<dyn Fn(&dyn RenderPlugin) + Send + Sync>,
    /// Register a menu item
    pub register_menu_item: Box<dyn Fn(MenuItem) + Send + Sync>,
    /// Access the core API
    pub get_core_api: Box<dyn Fn() -> &'static (dyn CoreApi + Send + Sync) + Send + Sync>,
}

impl PluginContext {
    /// Create a new plugin context
    pub fn new(
        register_command: impl Fn(String, Command) + Send + Sync + 'static,
        register_renderer: impl Fn(&dyn RenderPlugin) + Send + Sync + 'static,
        register_menu_item: impl Fn(MenuItem) + Send + Sync + 'static,
        get_core_api: impl Fn() -> &'static (dyn CoreApi + Send + Sync) + Send + Sync + 'static,
    ) -> Self {
        Self {
            register_command: Box::new(register_command),
            register_renderer: Box::new(register_renderer),
            register_menu_item: Box::new(register_menu_item),
            get_core_api: Box::new(get_core_api),
        }
    }

    /// Helper to register a command
    pub fn register_cmd(&self, id: String, cmd: Command) {
        (self.register_command)(id, cmd);
    }

    /// Helper to register a renderer
    pub fn register_renderer(&self, renderer: &dyn RenderPlugin) {
        (self.register_renderer)(renderer);
    }

    /// Helper to register a menu item
    pub fn register_menu(&self, item: MenuItem) {
        (self.register_menu_item)(item);
    }

    /// Access core API
    pub fn core_api(&self) -> &'static (dyn CoreApi + Send + Sync) {
        (self.get_core_api)()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_command_new() {
        let command = Command::new("test.command", "Test Command", || {});

        assert_eq!(command.id, "test.command");
        assert_eq!(command.name, "Test Command");
        assert!(command.description.is_none());
        assert!(command.shortcut.is_none());
        assert!(command.enabled);
    }

    #[test]
    fn test_command_with_description() {
        let command = Command::new("test.command", "Test Command", || {})
            .with_description("Runs a test command");

        assert_eq!(command.description.as_deref(), Some("Runs a test command"));
    }

    #[test]
    fn test_command_with_shortcut() {
        let command = Command::new("test.command", "Test Command", || {}).with_shortcut("Ctrl+T");

        assert_eq!(command.shortcut.as_deref(), Some("Ctrl+T"));
    }

    #[test]
    fn test_command_execute() {
        let executed = Arc::new(Mutex::new(false));
        let executed_flag = Arc::clone(&executed);
        let command = Command::new("test.command", "Test Command", move || {
            *executed_flag.lock().unwrap() = true;
        });

        command.execute();

        assert!(*executed.lock().unwrap());
    }

    #[test]
    fn test_menu_item_new() {
        let menu_item = MenuItem::new("file.export", "Export", "File", || {});

        assert_eq!(menu_item.id, "file.export");
        assert_eq!(menu_item.label, "Export");
        assert_eq!(menu_item.path, "File");
        assert!(menu_item.icon.is_none());
        assert!(menu_item.visible);
        assert!(menu_item.enabled);
    }

    #[test]
    fn test_menu_item_with_icon() {
        let menu_item = MenuItem::new("file.export", "Export", "File", || {}).with_icon("download");

        assert_eq!(menu_item.icon.as_deref(), Some("download"));
    }

    #[test]
    fn test_menu_item_execute() {
        let executed = Arc::new(Mutex::new(false));
        let executed_flag = Arc::clone(&executed);
        let menu_item = MenuItem::new("file.export", "Export", "File", move || {
            *executed_flag.lock().unwrap() = true;
        });

        menu_item.execute();

        assert!(*executed.lock().unwrap());
    }
}
