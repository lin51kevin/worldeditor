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
}
