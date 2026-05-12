//! Plugin context API — provides access to editor services

use we_core::model::Project;

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

/// Import handler: receives raw bytes + filename, returns a Project or error.
pub type ImportHandler = Box<dyn Fn(Vec<u8>, &str) -> Result<Project, String> + Send + Sync>;

/// Export handler: receives a project reference, returns raw bytes or error.
pub type ExportHandler = Box<dyn Fn(&Project) -> Result<Vec<u8>, String> + Send + Sync>;

/// Importer contribution registered by a plugin
pub struct ImporterContrib {
    /// Human-readable format name (e.g., "LAS Point Cloud")
    pub format_name: String,
    /// File extensions (e.g., [".las", ".laz"])
    pub extensions: Vec<String>,
    pub(crate) handler: ImportHandler,
}

impl ImporterContrib {
    /// Create a new importer contribution
    pub fn new<F>(format_name: &str, extensions: Vec<&str>, handler: F) -> Self
    where
        F: Fn(Vec<u8>, &str) -> Result<Project, String> + Send + Sync + 'static,
    {
        Self {
            format_name: format_name.to_string(),
            extensions: extensions.into_iter().map(|s| s.to_string()).collect(),
            handler: Box::new(handler),
        }
    }

    /// Execute the import handler
    pub fn import(&self, data: Vec<u8>, filename: &str) -> Result<Project, String> {
        (self.handler)(data, filename)
    }
}

/// Exporter contribution registered by a plugin
pub struct ExporterContrib {
    /// Human-readable format name (e.g., "LAS Point Cloud")
    pub format_name: String,
    pub(crate) handler: ExportHandler,
}

impl ExporterContrib {
    /// Create a new exporter contribution
    pub fn new<F>(format_name: &str, handler: F) -> Self
    where
        F: Fn(&Project) -> Result<Vec<u8>, String> + Send + Sync + 'static,
    {
        Self {
            format_name: format_name.to_string(),
            handler: Box::new(handler),
        }
    }

    /// Execute the export handler
    pub fn export(&self, project: &Project) -> Result<Vec<u8>, String> {
        (self.handler)(project)
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
    /// Get the current project (returns a clone)
    pub get_project: Box<dyn Fn() -> Project + Send + Sync>,
    /// Update the current project
    pub update_project: Box<dyn Fn(Project) + Send + Sync>,
    /// Execute a mutation with undo support
    #[allow(clippy::type_complexity)]
    pub execute_with_undo: Box<dyn Fn(&str, Box<dyn FnOnce(Project) -> Project + Send>) + Send + Sync>,
    /// Register an importer format
    pub register_importer: Box<dyn Fn(ImporterContrib) + Send + Sync>,
    /// Register an exporter format
    pub register_exporter: Box<dyn Fn(ExporterContrib) + Send + Sync>,
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
            get_project: Box::new(Project::default),
            update_project: Box::new(|_| {}),
            execute_with_undo: Box::new(|_, _| {}),
            register_importer: Box::new(|_| {}),
            register_exporter: Box::new(|_| {}),
        }
    }

    /// Create a full plugin context with all capabilities
    #[allow(clippy::too_many_arguments)]
    pub fn new_full(
        register_command: impl Fn(String, Command) + Send + Sync + 'static,
        register_renderer: impl Fn(&dyn RenderPlugin) + Send + Sync + 'static,
        register_menu_item: impl Fn(MenuItem) + Send + Sync + 'static,
        get_core_api: impl Fn() -> &'static (dyn CoreApi + Send + Sync) + Send + Sync + 'static,
        get_project: impl Fn() -> Project + Send + Sync + 'static,
        update_project: impl Fn(Project) + Send + Sync + 'static,
        execute_with_undo: impl Fn(&str, Box<dyn FnOnce(Project) -> Project + Send>) + Send + Sync + 'static,
        register_importer: impl Fn(ImporterContrib) + Send + Sync + 'static,
        register_exporter: impl Fn(ExporterContrib) + Send + Sync + 'static,
    ) -> Self {
        Self {
            register_command: Box::new(register_command),
            register_renderer: Box::new(register_renderer),
            register_menu_item: Box::new(register_menu_item),
            get_core_api: Box::new(get_core_api),
            get_project: Box::new(get_project),
            update_project: Box::new(update_project),
            execute_with_undo: Box::new(execute_with_undo),
            register_importer: Box::new(register_importer),
            register_exporter: Box::new(register_exporter),
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

    /// Get a clone of the current project
    pub fn project(&self) -> Project {
        (self.get_project)()
    }

    /// Replace the current project
    pub fn set_project(&self, project: Project) {
        (self.update_project)(project);
    }

    /// Execute a project mutation with undo support
    pub fn with_undo<F>(&self, description: &str, mutate: F)
    where
        F: FnOnce(Project) -> Project + Send + 'static,
    {
        (self.execute_with_undo)(description, Box::new(mutate));
    }

    /// Register an importer format
    pub fn add_importer(&self, importer: ImporterContrib) {
        (self.register_importer)(importer);
    }

    /// Register an exporter format
    pub fn add_exporter(&self, exporter: ExporterContrib) {
        (self.register_exporter)(exporter);
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

    #[test]
    fn test_importer_contrib_new() {
        let importer = ImporterContrib::new(
            "Test Format",
            vec![".test", ".tst"],
            |_data, _name| Ok(Project::default()),
        );

        assert_eq!(importer.format_name, "Test Format");
        assert_eq!(importer.extensions, vec![".test", ".tst"]);
    }

    #[test]
    fn test_importer_contrib_import() {
        let importer = ImporterContrib::new(
            "Test Format",
            vec![".test"],
            |_data, _name| {
                let mut proj = Project::default();
                proj.name = "imported".to_string();
                Ok(proj)
            },
        );

        let result = importer.import(vec![1, 2, 3], "test.test").unwrap();
        assert_eq!(result.name, "imported");
    }

    #[test]
    fn test_exporter_contrib_new() {
        let exporter = ExporterContrib::new("Test Format", |_proj| Ok(vec![]));

        assert_eq!(exporter.format_name, "Test Format");
    }

    #[test]
    fn test_exporter_contrib_export() {
        let exporter = ExporterContrib::new("Test Format", |proj| {
            Ok(proj.name.as_bytes().to_vec())
        });

        let mut project = Project::default();
        project.name = "export_me".to_string();
        let result = exporter.export(&project).unwrap();
        assert_eq!(result, b"export_me");
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
    fn test_plugin_context_get_project_returns_default() {
        let ctx = test_context();
        let project = ctx.project();
        // default context returns default project
        assert!(project.roads.is_empty());
    }

    #[test]
    fn test_plugin_context_set_project_calls_handler() {
        let received = Arc::new(Mutex::new(String::new()));
        let received_clone = Arc::clone(&received);

        let ctx = PluginContext::new_full(
            |_, _| {},
            |_| {},
            |_| {},
            || &TEST_CORE_API,
            Project::default,
            move |proj| {
                *received_clone.lock().unwrap() = proj.name.clone();
            },
            |_, _| {},
            |_| {},
            |_| {},
        );

        let mut project = Project::default();
        project.name = "updated".to_string();
        ctx.set_project(project);

        assert_eq!(*received.lock().unwrap(), "updated");
    }

    #[test]
    fn test_plugin_context_with_undo_calls_handler() {
        let description_received = Arc::new(Mutex::new(String::new()));
        let desc_clone = Arc::clone(&description_received);

        let ctx = PluginContext::new_full(
            |_, _| {},
            |_| {},
            |_| {},
            || &TEST_CORE_API,
            Project::default,
            |_| {},
            move |desc, _mutate| {
                *desc_clone.lock().unwrap() = desc.to_string();
            },
            |_| {},
            |_| {},
        );

        ctx.with_undo("Add road", |proj| proj);

        assert_eq!(*description_received.lock().unwrap(), "Add road");
    }

    #[test]
    fn test_plugin_context_add_importer_calls_handler() {
        let registered = Arc::new(Mutex::new(String::new()));
        let reg_clone = Arc::clone(&registered);

        let ctx = PluginContext::new_full(
            |_, _| {},
            |_| {},
            |_| {},
            || &TEST_CORE_API,
            Project::default,
            |_| {},
            |_, _| {},
            move |contrib| {
                *reg_clone.lock().unwrap() = contrib.format_name.clone();
            },
            |_| {},
        );

        ctx.add_importer(ImporterContrib::new(
            "LAS Point Cloud",
            vec![".las"],
            |_, _| Ok(Project::default()),
        ));

        assert_eq!(*registered.lock().unwrap(), "LAS Point Cloud");
    }

    #[test]
    fn test_plugin_context_add_exporter_calls_handler() {
        let registered = Arc::new(Mutex::new(String::new()));
        let reg_clone = Arc::clone(&registered);

        let ctx = PluginContext::new_full(
            |_, _| {},
            |_| {},
            |_| {},
            || &TEST_CORE_API,
            Project::default,
            |_| {},
            |_, _| {},
            |_| {},
            move |contrib| {
                *reg_clone.lock().unwrap() = contrib.format_name.clone();
            },
        );

        ctx.add_exporter(ExporterContrib::new("JSON Format", |_| Ok(vec![])));

        assert_eq!(*registered.lock().unwrap(), "JSON Format");
    }
}
