use std::{net::SocketAddr, sync::Arc};

use axum::{
    Router, middleware,
    routing::{get, post},
};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;

use we_server::{api, auth, storage, ws};

#[derive(Clone)]
#[allow(dead_code)]
struct AppState {
    pool: sqlx::PgPool,
    storage: storage::LocalStorage,
    auth_service: Arc<auth::AuthService>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    env_logger::init();

    // Database connection
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/worldeditor".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Storage backend
    let storage_backend = storage::LocalStorage::new("./uploads");

    // Auth service
    let auth_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "secret".to_string());
    let auth_service = Arc::new(auth::AuthService::new(auth_secret));

    // App state
    let state = AppState {
        pool: pool.clone(),
        storage: storage_backend,
        auth_service: auth_service.clone(),
    };

    // Protected API routes (require JWT)
    let protected_routes = Router::new()
        .nest(
            "/api/projects",
            api::project::router().with_state(pool.clone()),
        )
        .layer(middleware::from_fn_with_state(
            auth_service.clone(),
            auth::jwt::auth_middleware,
        ));

    // WebSocket route (unprotected for now, but could add auth later)
    let ws_routes =
        Router::new().route("/ws/editor/:project_id", get(ws::editor::editor_ws_handler));

    // Auth routes (unprotected)
    let auth_routes = Router::new()
        .route("/api/auth/login", post(login_handler))
        .with_state(state.clone());

    // CORS configuration — restrict to known origins in production
    let allowed_origins = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173,http://localhost:3000".to_string());
    let origins: Vec<axum::http::HeaderValue> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    if origins.is_empty() {
        anyhow::bail!("CORS_ORIGINS environment variable is set but contains no valid origins");
    }

    // Combine all routes
    let app = Router::new()
        .merge(protected_routes)
        .merge(ws_routes)
        .merge(auth_routes)
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(vec![
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::ACCEPT,
                ]),
        );

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    log::info!("Server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn login_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Result<axum::Json<serde_json::Value>> {
    // TODO: implement actual login logic with user validation
    let token = state
        .auth_service
        .generate_token("user_id")
        .map_err(|_e| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(axum::Json(serde_json::json!({
        "token": token
    })))
}
