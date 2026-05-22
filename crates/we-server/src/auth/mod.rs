pub mod jwt;

use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use axum_extra::TypedHeader;
use axum_extra::headers::{Authorization, authorization::Bearer};
use jsonwebtoken::{Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::error::{Error, Result};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
}

pub struct AuthService {
    secret: String,
}

impl AuthService {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn generate_token(&self, user_id: &str) -> Result<String> {
        let now = chrono::Utc::now();
        let exp = now + chrono::Duration::hours(24);

        let claims = Claims {
            sub: user_id.to_string(),
            exp: exp.timestamp() as usize,
            iat: now.timestamp() as usize,
        };

        encode(
            &Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(Error::Jwt)
    }

    pub fn verify_token(&self, token: &str) -> Result<Claims> {
        let token_data = decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(Error::Jwt)?;

        Ok(token_data.claims)
    }
}

#[async_trait]
impl FromRequestParts<Arc<AuthService>> for Claims {
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AuthService>) -> Result<Self> {
        let TypedHeader(bearer) =
            TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, state)
                .await
                .map_err(|_| Error::Auth)?;

        state.verify_token(bearer.token())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_service(secret: &str) -> AuthService {
        AuthService::new(secret.to_string())
    }

    #[test]
    fn test_generate_token_returns_valid_jwt() {
        let service = make_service("test-secret");
        let token = service.generate_token("user-123").unwrap();

        assert_eq!(token.matches('.').count(), 2);
        let claims = service.verify_token(&token).unwrap();
        assert_eq!(claims.sub, "user-123");
    }

    #[test]
    fn test_verify_token_with_invalid_token_returns_error() {
        let service = make_service("test-secret");

        assert!(service.verify_token("this-is-not-a-jwt").is_err());
    }

    #[test]
    fn test_verify_token_with_expired_token_returns_error() {
        let service = make_service("test-secret");
        let now = chrono::Utc::now();
        let expired_claims = Claims {
            sub: "expired-user".to_string(),
            exp: (now - chrono::Duration::hours(1)).timestamp() as usize,
            iat: (now - chrono::Duration::hours(2)).timestamp() as usize,
        };
        let expired_token = jsonwebtoken::encode(
            &Header::default(),
            &expired_claims,
            &jsonwebtoken::EncodingKey::from_secret(b"test-secret"),
        )
        .unwrap();

        assert!(service.verify_token(&expired_token).is_err());
    }

    #[test]
    fn test_generate_token_contains_correct_subject() {
        let service = make_service("test-secret");
        let token = service.generate_token("subject-user").unwrap();
        let claims = service.verify_token(&token).unwrap();

        assert_eq!(claims.sub, "subject-user");
    }

    #[test]
    fn test_verify_token_with_wrong_secret_fails() {
        let token = make_service("test-secret")
            .generate_token("user-123")
            .unwrap();

        assert!(
            make_service("different-secret")
                .verify_token(&token)
                .is_err()
        );
    }
}
