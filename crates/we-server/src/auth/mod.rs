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
