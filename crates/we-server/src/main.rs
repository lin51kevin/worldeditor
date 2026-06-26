use std::{net::SocketAddr, sync::Arc};

use anyhow::Context;
#[cfg(feature = "websocket")]
use axum::routing::get;
use axum::{Router, middleware, routing::post};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;

#[cfg(feature = "websocket")]
use we_server::ws;
use we_server::{api, auth, storage};

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
        .context("DATABASE_URL environment variable must be set")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Storage backend
    let storage_backend = storage::LocalStorage::new("./uploads");

    // Auth service
    let auth_secret = std::env::var("JWT_SECRET")
        .context("JWT_SECRET environment variable must be set")?;
    if auth_secret.len() < 32 {
        anyhow::bail!("JWT_SECRET must be at least 32 characters long");
    }
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
    #[cfg(feature = "websocket")]
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
    let app = Router::new().merge(protected_routes).merge(auth_routes);
    #[cfg(feature = "websocket")]
    let app = app.merge(ws_routes);
    let app = app.layer(
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

#[derive(Debug, serde::Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(payload): axum::Json<LoginRequest>,
) -> axum::response::Result<axum::Json<serde_json::Value>> {
    // Validate input
    if payload.username.is_empty() || payload.password.is_empty() {
        return Err(axum::http::StatusCode::BAD_REQUEST.into());
    }
    if payload.username.len() > 256 || payload.password.len() > 256 {
        return Err(axum::http::StatusCode::BAD_REQUEST.into());
    }

    // TODO: Replace with real credential validation against database
    // For now, validate against environment variables for development
    let expected_user = std::env::var("ADMIN_USER").unwrap_or_default();
    let expected_pass = std::env::var("ADMIN_PASS").unwrap_or_default();
    if expected_user.is_empty() || expected_pass.is_empty() {
        log::error!("ADMIN_USER/ADMIN_PASS not configured — login disabled");
        return Err(axum::http::StatusCode::SERVICE_UNAVAILABLE.into());
    }
    if payload.username != expected_user || payload.password != expected_pass {
        return Err(axum::http::StatusCode::UNAUTHORIZED.into());
    }

    let token = state
        .auth_service
        .generate_token(&payload.username)
        .map_err(|_e| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(axum::Json(serde_json::json!({
        "token": token
    })))
}
