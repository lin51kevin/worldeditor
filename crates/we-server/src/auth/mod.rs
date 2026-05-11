pub mod jwt;

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::request::Parts,
};
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
        let TypedHeader(bearer) = TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, state)
            .await
            .map_err(|_| Error::Auth)?;

        state.verify_token(bearer.token())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_service() -> AuthService {
        AuthService::new("test-secret-key-for-jwt-signing".into())
    }

    #[test]
    fn test_generate_and_verify_roundtrip() {
        let svc = make_service();
        let token = svc.generate_token("user-42").unwrap();
        let claims = svc.verify_token(&token).unwrap();
        assert_eq!(claims.sub, "user-42");
    }

    #[test]
    fn test_claims_has_valid_timestamps() {
        let svc = make_service();
        let token = svc.generate_token("u1").unwrap();
        let claims = svc.verify_token(&token).unwrap();
        assert!(claims.exp > claims.iat);
        // Expiry should be ~24h in the future
        let diff = claims.exp - claims.iat;
        assert!(diff >= 86000 && diff <= 87000);
    }

    #[test]
    fn test_verify_rejects_tampered_token() {
        let svc = make_service();
        let token = svc.generate_token("u1").unwrap();
        let tampered = format!("{}x", token);
        assert!(svc.verify_token(&tampered).is_err());
    }

    #[test]
    fn test_verify_rejects_wrong_secret() {
        let svc1 = AuthService::new("secret-1".into());
        let svc2 = AuthService::new("secret-2".into());
        let token = svc1.generate_token("u1").unwrap();
        assert!(svc2.verify_token(&token).is_err());
    }

    #[test]
    fn test_verify_rejects_garbage() {
        let svc = make_service();
        assert!(svc.verify_token("not.a.jwt").is_err());
        assert!(svc.verify_token("").is_err());
    }

    #[test]
    fn test_different_users_get_different_tokens() {
        let svc = make_service();
        let t1 = svc.generate_token("alice").unwrap();
        let t2 = svc.generate_token("bob").unwrap();
        assert_ne!(t1, t2);
        assert_eq!(svc.verify_token(&t1).unwrap().sub, "alice");
        assert_eq!(svc.verify_token(&t2).unwrap().sub, "bob");
    }
}
