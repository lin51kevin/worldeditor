//! Road linking model types.
//!
//! This module contains predecessor/successor link metadata shared by roads and
//! junction connections.

use serde::{Deserialize, Serialize};

/// Link to predecessor/successor roads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadLink {
    pub predecessor: Option<LinkElement>,
    pub successor: Option<LinkElement>,
}

/// A single link element (road or junction reference).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkElement {
    pub element_type: LinkElementType,
    pub element_id: String,
    pub contact_point: Option<ContactPoint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkElementType {
    Road,
    Junction,
}

/// Contact point on a road.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ContactPoint {
    Start,
    End,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contact_point_serialization() {
        let start_json = serde_json::to_string(&ContactPoint::Start).unwrap();
        let end_json = serde_json::to_string(&ContactPoint::End).unwrap();

        assert_eq!(start_json, "\"Start\"");
        assert_eq!(end_json, "\"End\"");
        assert_eq!(
            serde_json::from_str::<ContactPoint>(&start_json).unwrap(),
            ContactPoint::Start
        );
        assert_eq!(
            serde_json::from_str::<ContactPoint>(&end_json).unwrap(),
            ContactPoint::End
        );
    }

    #[test]
    fn test_road_link_serialization() {
        let link = RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: "road-prev".to_string(),
                contact_point: Some(ContactPoint::Start),
            }),
            successor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: "junction-1".to_string(),
                contact_point: Some(ContactPoint::End),
            }),
        };

        let json = serde_json::to_string(&link).unwrap();
        let deserialized: RoadLink = serde_json::from_str(&json).unwrap();
        let predecessor = deserialized.predecessor.unwrap();
        let successor = deserialized.successor.unwrap();
        assert_eq!(predecessor.element_type, LinkElementType::Road);
        assert_eq!(predecessor.element_id, "road-prev");
        assert_eq!(predecessor.contact_point, Some(ContactPoint::Start));
        assert_eq!(successor.element_type, LinkElementType::Junction);
        assert_eq!(successor.element_id, "junction-1");
        assert_eq!(successor.contact_point, Some(ContactPoint::End));
    }
}
