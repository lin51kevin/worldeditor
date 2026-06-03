//! JWT utilities.
//!
//! This module is re-exported via `auth::jwt`.

use axum::{middleware::Next, response::Response};
use axum_extra::TypedHeader;
use axum_extra::headers::{Authorization, authorization::Bearer};
use std::sync::Arc;

use crate::auth::AuthService;
use crate::error::Error;

pub async fn auth_middleware(
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
    axum::extract::State(auth_service): axum::extract::State<Arc<AuthService>>,
    mut request: axum::extract::Request,
    next: Next,
) -> Result<Response, Error> {
    let claims = auth_service.verify_token(auth.token())?;
    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AuthService, Claims};
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        middleware,
        routing::get,
    };
    use tower::ServiceExt;

    /// Protected handler that echoes the authenticated subject extracted by the
    /// middleware, proving the `Claims` were inserted into request extensions.
    async fn protected_handler(request: axum::extract::Request) -> String {
        request
            .extensions()
            .get::<Claims>()
            .map(|c| c.sub.clone())
            .unwrap_or_else(|| "no-claims".to_string())
    }

    fn test_app(secret: &str) -> Router {
        let auth = Arc::new(AuthService::new(secret.to_string()));
        Router::new()
            .route("/protected", get(protected_handler))
            .route_layer(middleware::from_fn_with_state(auth, auth_middleware))
    }

    #[tokio::test]
    async fn auth_middleware_allows_valid_token_and_injects_claims() {
        let secret = "unit-test-secret";
        let token = AuthService::new(secret.to_string())
            .generate_token("user-123")
            .unwrap();

        let response = test_app(secret)
            .oneshot(
                Request::builder()
                    .uri("/protected")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"user-123");
    }

    #[tokio::test]
    async fn auth_middleware_rejects_invalid_token() {
        let response = test_app("unit-test-secret")
            .oneshot(
                Request::builder()
                    .uri("/protected")
                    .header("Authorization", "Bearer not-a-real-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_middleware_rejects_token_signed_with_wrong_secret() {
        let token = AuthService::new("attacker-secret".to_string())
            .generate_token("user-123")
            .unwrap();

        let response = test_app("server-secret")
            .oneshot(
                Request::builder()
                    .uri("/protected")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_middleware_rejects_missing_authorization_header() {
        let response = test_app("unit-test-secret")
            .oneshot(
                Request::builder()
                    .uri("/protected")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Missing/!malformed Authorization header is rejected before reaching
        // token verification (TypedHeader extraction failure).
        assert_ne!(response.status(), StatusCode::OK);
    }
}
