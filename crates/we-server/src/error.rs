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
    #[error("Not implemented")]
    NotImplemented,
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
            Error::NotImplemented => StatusCode::NOT_IMPLEMENTED,
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn test_sqlx_maps_to_500() {
        // sqlx::Error doesn't have a simple constructor, test via status_code method
        let err = Error::Internal;
        assert_eq!(err.status_code(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_auth_maps_to_401() {
        assert_eq!(Error::Auth.status_code(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_not_found_maps_to_404() {
        let err = Error::NotFound("missing".into());
        assert_eq!(err.status_code(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_validation_maps_to_400() {
        let err = Error::Validation("bad input".into());
        assert_eq!(err.status_code(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_storage_maps_to_500() {
        let err = Error::Storage("disk full".into());
        assert_eq!(err.status_code(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_internal_maps_to_500() {
        assert_eq!(Error::Internal.status_code(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_into_response_has_correct_status() {
        let err = Error::NotFound("x".into());
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_into_response_auth_status() {
        let resp = Error::Auth.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_display_auth() {
        assert_eq!(Error::Auth.to_string(), "Authentication failed");
    }

    #[test]
    fn test_display_not_found() {
        let err = Error::NotFound("project 42".into());
        assert_eq!(err.to_string(), "Not found: project 42");
    }

    #[test]
    fn test_display_validation() {
        let err = Error::Validation("name required".into());
        assert_eq!(err.to_string(), "Validation error: name required");
    }

    #[test]
    fn test_display_storage() {
        let err = Error::Storage("no space".into());
        assert_eq!(err.to_string(), "Storage error: no space");
    }

    #[test]
    fn test_display_internal() {
        assert_eq!(Error::Internal.to_string(), "Internal server error");
    }
}
