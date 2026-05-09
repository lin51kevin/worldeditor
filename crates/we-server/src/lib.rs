//! WorldEditor web server library.
//!
//! Provides REST API, authentication, WebSocket, and storage abstractions.

pub mod api;
pub mod auth;
pub mod error;
pub mod storage;
pub mod ws;

pub use error::{Error, Result};
