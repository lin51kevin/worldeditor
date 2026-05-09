//! WebSocket real-time editor.
//!
//! This module provides WebSocket endpoints for collaborative editing.
//! Currently a placeholder for future implementation.

use axum::{
    extract::{Path, WebSocketUpgrade},
    response::Response,
};
use uuid::Uuid;

pub async fn editor_ws_handler(Path(project_id): Path<Uuid>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| async move {
        // TODO: implement WebSocket handling
        drop(socket);
    })
}
