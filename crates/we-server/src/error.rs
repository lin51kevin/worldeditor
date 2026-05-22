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

        // Log detailed error server-side for debugging
        match &self {
            Error::Sqlx(e) => log::error!("Database error: {e}"),
            Error::Storage(e) => log::error!("Storage error: {e}"),
            Error::Internal => log::error!("Internal server error"),
            _ => {}
        }

        // Return generic message for internal errors to avoid leaking implementation details
        let user_message = match &self {
            Error::Sqlx(_) | Error::Storage(_) | Error::Internal => {
                "An internal error occurred".to_string()
            }
            Error::Jwt(_) => "Invalid or expired authentication token".to_string(),
            Error::Auth => "Authentication failed".to_string(),
            Error::NotFound(resource) => format!("Resource not found: {resource}"),
            Error::Validation(msg) => format!("Validation error: {msg}"),
            Error::NotImplemented => "This feature is not yet available".to_string(),
        };

        let body = json!({
            "error": user_message,
        });

        (status, axum::Json(body)).into_response()
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[test]
    fn test_sqlx_error_maps_to_500() {
        let error = Error::Sqlx(sqlx::Error::RowNotFound);

        assert_eq!(error.status_code(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_auth_error_maps_to_401() {
        assert_eq!(Error::Auth.status_code(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_not_found_error_maps_to_404() {
        let error = Error::NotFound("project-1".to_string());

        assert_eq!(error.status_code(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_validation_error_maps_to_400() {
        let error = Error::Validation("invalid input".to_string());

        assert_eq!(error.status_code(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_not_implemented_error_maps_to_501() {
        assert_eq!(
            Error::NotImplemented.status_code(),
            StatusCode::NOT_IMPLEMENTED
        );
    }

    #[tokio::test]
    async fn test_error_response_contains_json_body() {
        let response = Error::Validation("name required".to_string()).into_response();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(body_json["error"], "Validation error: name required");
    }

    #[tokio::test]
    async fn test_internal_error_does_not_leak_details() {
        let response = Error::Sqlx(sqlx::Error::RowNotFound).into_response();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // Must NOT contain "Database error" or implementation details
        assert_eq!(body_json["error"], "An internal error occurred");
    }
}
