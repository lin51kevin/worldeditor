//! WebSocket real-time collaborative editor.
//!
//! Clients connect to `/ws/editor/{project_id}` and join a per-project "room".
//! Every text frame a client sends is fanned out to all other clients editing
//! the same project, enabling real-time collaboration (edits, cursor positions,
//! presence). Rooms are created lazily on first join and reclaimed when the last
//! participant disconnects.
//!
//! The transport-agnostic [`CollabHub`] holds all room/broadcast logic and is
//! fully unit-testable without a live socket; [`editor_ws_handler`] is the thin
//! Axum glue that pumps frames between a [`WebSocket`] and its room.

use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

/// Per-room broadcast capacity. When a slow client lags beyond this many
/// buffered messages it receives a `Lagged` notice and resynchronises.
const ROOM_CAPACITY: usize = 256;

/// A message exchanged over a project's collaborative editing channel.
///
/// The wire format is JSON tagged on `type`, e.g.
/// `{"type":"cursor","client_id":"abc","x":1.0,"y":2.0}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EditorMessage {
    /// A client joined the room.
    Join { client_id: String },
    /// A client left the room.
    Leave { client_id: String },
    /// A collaborative edit operation (opaque payload applied by clients).
    Edit {
        client_id: String,
        op: serde_json::Value,
    },
    /// A cursor / selection position update.
    Cursor { client_id: String, x: f64, y: f64 },
}

impl EditorMessage {
    /// The id of the client that originated this message.
    pub fn client_id(&self) -> &str {
        match self {
            EditorMessage::Join { client_id }
            | EditorMessage::Leave { client_id }
            | EditorMessage::Edit { client_id, .. }
            | EditorMessage::Cursor { client_id, .. } => client_id,
        }
    }
}

/// In-memory hub mapping a project id to a broadcast "room".
///
/// Cloning a [`CollabHub`] yields another handle to the same shared room table,
/// so it can be stored in Axum router state and shared across connections.
#[derive(Clone, Default)]
pub struct CollabHub {
    rooms: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
}

impl CollabHub {
    /// Create an empty hub with no active rooms.
    pub fn new() -> Self {
        Self::default()
    }

    /// Join a project's room, creating it on first use.
    ///
    /// Returns the room's sender (for broadcasting to peers) and a fresh
    /// receiver subscribed to all subsequent messages.
    pub async fn join(
        &self,
        project_id: Uuid,
    ) -> (broadcast::Sender<String>, broadcast::Receiver<String>) {
        let mut rooms = self.rooms.lock().await;
        let sender = rooms
            .entry(project_id)
            .or_insert_with(|| broadcast::channel(ROOM_CAPACITY).0);
        (sender.clone(), sender.subscribe())
    }

    /// Number of rooms that currently exist.
    pub async fn room_count(&self) -> usize {
        self.rooms.lock().await.len()
    }

    /// Number of connected participants in a room (0 if the room is absent).
    pub async fn participant_count(&self, project_id: Uuid) -> usize {
        self.rooms
            .lock()
            .await
            .get(&project_id)
            .map(broadcast::Sender::receiver_count)
            .unwrap_or(0)
    }

    /// Broadcast a raw text message to everyone in a room.
    ///
    /// Returns the number of receivers the message was delivered to. A missing
    /// room (or one with no live receivers) yields `0`.
    pub async fn broadcast(&self, project_id: Uuid, message: &str) -> usize {
        let rooms = self.rooms.lock().await;
        match rooms.get(&project_id) {
            Some(sender) => sender.send(message.to_string()).unwrap_or(0),
            None => 0,
        }
    }

    /// Drop a room if no participants remain, freeing its broadcast channel.
    pub async fn reclaim_if_empty(&self, project_id: Uuid) {
        let mut rooms = self.rooms.lock().await;
        if let Some(sender) = rooms.get(&project_id)
            && sender.receiver_count() == 0
        {
            rooms.remove(&project_id);
        }
    }
}

/// Axum handler: upgrade the connection and attach it to the project's room.
pub async fn editor_ws_handler(
    Path(project_id): Path<Uuid>,
    State(hub): State<CollabHub>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, project_id, hub))
}

/// Pump frames between a single client socket and its project room.
///
/// Inbound text frames are re-broadcast to the room; room messages are written
/// back to the socket. The loop ends when the client closes the socket or errors.
async fn handle_socket(mut socket: WebSocket, project_id: Uuid, hub: CollabHub) {
    let (room_tx, mut room_rx) = hub.join(project_id).await;

    loop {
        tokio::select! {
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        // Fan out to peers (and back to self; clients filter by client_id).
                        let _ = room_tx.send(text);
                    }
                    // Ignore binary/ping/pong; Axum handles keep-alive.
                    Some(Ok(_)) => {}
                    // Close frame, stream end, or transport error → disconnect.
                    Some(Err(_)) | None => break,
                }
            }
            outbound = room_rx.recv() => {
                match outbound {
                    Ok(text) => {
                        if socket.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    // Slow consumer: skip dropped messages and keep going.
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    // Room closed: nothing more to deliver.
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    drop(room_rx);
    hub.reclaim_if_empty(project_id).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_message_round_trips_through_json() {
        let cases = vec![
            EditorMessage::Join {
                client_id: "alice".into(),
            },
            EditorMessage::Leave {
                client_id: "bob".into(),
            },
            EditorMessage::Cursor {
                client_id: "carol".into(),
                x: 1.5,
                y: -2.5,
            },
            EditorMessage::Edit {
                client_id: "dave".into(),
                op: serde_json::json!({ "kind": "move", "road": "r1" }),
            },
        ];
        for msg in cases {
            let json = serde_json::to_string(&msg).unwrap();
            let back: EditorMessage = serde_json::from_str(&json).unwrap();
            assert_eq!(back, msg);
        }
    }

    #[test]
    fn editor_message_uses_tagged_snake_case_wire_format() {
        let json = serde_json::to_string(&EditorMessage::Cursor {
            client_id: "x".into(),
            x: 0.0,
            y: 0.0,
        })
        .unwrap();
        assert!(json.contains("\"type\":\"cursor\""));
        assert!(json.contains("\"client_id\":\"x\""));
    }

    #[test]
    fn client_id_accessor_returns_originator() {
        assert_eq!(
            EditorMessage::Join {
                client_id: "alice".into()
            }
            .client_id(),
            "alice"
        );
    }

    #[tokio::test]
    async fn new_hub_has_no_rooms() {
        let hub = CollabHub::new();
        assert_eq!(hub.room_count().await, 0);
    }

    #[tokio::test]
    async fn join_creates_room_and_counts_participant() {
        let hub = CollabHub::new();
        let project = Uuid::new_v4();
        let (_tx, _rx) = hub.join(project).await;

        assert_eq!(hub.room_count().await, 1);
        assert_eq!(hub.participant_count(project).await, 1);
    }

    #[tokio::test]
    async fn two_clients_share_one_room() {
        let hub = CollabHub::new();
        let project = Uuid::new_v4();
        let (_tx1, _rx1) = hub.join(project).await;
        let (_tx2, _rx2) = hub.join(project).await;

        assert_eq!(hub.room_count().await, 1);
        assert_eq!(hub.participant_count(project).await, 2);
    }

    #[tokio::test]
    async fn broadcast_reaches_every_participant() {
        let hub = CollabHub::new();
        let project = Uuid::new_v4();
        let (_tx1, mut rx1) = hub.join(project).await;
        let (_tx2, mut rx2) = hub.join(project).await;

        let delivered = hub.broadcast(project, "hello").await;
        assert_eq!(delivered, 2);
        assert_eq!(rx1.recv().await.unwrap(), "hello");
        assert_eq!(rx2.recv().await.unwrap(), "hello");
    }

    #[tokio::test]
    async fn broadcast_to_missing_room_delivers_to_nobody() {
        let hub = CollabHub::new();
        assert_eq!(hub.broadcast(Uuid::new_v4(), "ignored").await, 0);
    }

    #[tokio::test]
    async fn rooms_are_isolated_per_project() {
        let hub = CollabHub::new();
        let project_a = Uuid::new_v4();
        let project_b = Uuid::new_v4();
        let (_txa, mut rxa) = hub.join(project_a).await;
        let (_txb, mut rxb) = hub.join(project_b).await;

        hub.broadcast(project_a, "for-a").await;

        assert_eq!(rxa.recv().await.unwrap(), "for-a");
        // Project B receives nothing — its channel stays empty.
        assert!(rxb.try_recv().is_err());
    }

    #[tokio::test]
    async fn reclaim_removes_room_after_all_participants_leave() {
        let hub = CollabHub::new();
        let project = Uuid::new_v4();
        {
            let (_tx, _rx) = hub.join(project).await;
            assert_eq!(hub.participant_count(project).await, 1);
        } // receiver dropped here

        hub.reclaim_if_empty(project).await;
        assert_eq!(hub.room_count().await, 0);
    }

    #[tokio::test]
    async fn reclaim_keeps_room_with_active_participants() {
        let hub = CollabHub::new();
        let project = Uuid::new_v4();
        let (_tx, _rx) = hub.join(project).await;

        hub.reclaim_if_empty(project).await;
        assert_eq!(hub.room_count().await, 1);
    }
}
