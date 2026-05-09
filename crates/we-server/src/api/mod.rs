pub mod files;
pub mod project;

use axum::Router;

pub fn router() -> Router<sqlx::PgPool> {
    Router::new()
        .nest("/projects", project::router())
        // Note: files router requires StorageBackend type param, add when integrating
}
