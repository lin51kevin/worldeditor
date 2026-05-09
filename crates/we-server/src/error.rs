use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("Database error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("Invalid JWT token: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("Authentication failed")]
    Auth,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Internal server error")]
    Internal,
}

impl Error {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Error::Sqlx(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Error::Jwt(_) => StatusCode::UNAUTHORIZED,
            Error::Auth => StatusCode::UNAUTHORIZED,
            Error::NotFound(_) => StatusCode::NOT_FOUND,
            Error::Validation(_) => StatusCode::BAD_REQUEST,
            Error::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Error::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = json!({
            "error": self.to_string(),
        });

        (status, axum::Json(body)).into_response()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
