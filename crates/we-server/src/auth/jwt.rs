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
