//! WorldEditor web server library.
//!
//! Provides REST API, authentication, WebSocket, and storage abstractions.

pub mod api;
pub mod auth;
pub mod error;
pub mod storage;
#[cfg(feature = "websocket")]
pub mod ws;

pub use error::{Error, Result};
