//! Traffic signal phasing and group model.
//!
//! Represents signal controllers, phases, and groups for intersection
//! traffic management (OpenDRIVE + SUMO compatible).

use serde::{Deserialize, Serialize};

/// A signal phase — a single timed state within a signal cycle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalPhase {
    /// Phase identifier.
    pub id: String,
    /// Duration in seconds.
    pub duration: f64,
    /// IDs of the signal groups that are GREEN in this phase.
    pub green_groups: Vec<String>,
    /// IDs of the signal groups in all-red (clearance) state.
    pub all_red_groups: Vec<String>,
}

impl SignalPhase {
    pub fn new(id: impl Into<String>, duration: f64) -> Self {
        Self {
            id: id.into(),
            duration,
            green_groups: Vec::new(),
            all_red_groups: Vec::new(),
        }
    }
}

/// A signal group — a set of signal heads sharing the same state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalGroup {
    /// Group identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// IDs of road signals belonging to this group.
    pub signal_ids: Vec<String>,
}

impl SignalGroup {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            signal_ids: Vec::new(),
        }
    }
}

/// A signal controller — manages a set of phases for an intersection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalController {
    pub id: String,
    pub junction_id: Option<String>,
    pub phases: Vec<SignalPhase>,
    pub groups: Vec<SignalGroup>,
    /// Total cycle length in seconds (sum of phase durations).
    pub cycle_length: f64,
}

impl SignalController {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            junction_id: None,
            phases: Vec::new(),
            groups: Vec::new(),
            cycle_length: 0.0,
        }
    }

    /// Recompute cycle_length from phase durations.
    pub fn update_cycle_length(&mut self) {
        self.cycle_length = self.phases.iter().map(|p| p.duration).sum();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signal_phase_new() {
        let p = SignalPhase::new("phase1", 30.0);
        assert_eq!(p.id, "phase1");
        assert_eq!(p.duration, 30.0);
        assert!(p.green_groups.is_empty());
    }

    #[test]
    fn test_signal_group_new() {
        let g = SignalGroup::new("sg1", "Left Turn");
        assert_eq!(g.name, "Left Turn");
        assert!(g.signal_ids.is_empty());
    }

    #[test]
    fn test_controller_cycle_length() {
        let mut ctrl = SignalController::new("ctrl1");
        ctrl.phases.push(SignalPhase::new("p1", 30.0));
        ctrl.phases.push(SignalPhase::new("p2", 5.0));
        ctrl.phases.push(SignalPhase::new("p3", 45.0));
        ctrl.update_cycle_length();
        assert_eq!(ctrl.cycle_length, 80.0);
    }

    #[test]
    fn test_controller_serialization() {
        let ctrl = SignalController::new("ctrl1");
        let json = serde_json::to_string(&ctrl).unwrap();
        let back: SignalController = serde_json::from_str(&json).unwrap();
        assert_eq!(ctrl, back);
    }

    #[test]
    fn test_phase_with_groups() {
        let mut phase = SignalPhase::new("p1", 30.0);
        phase.green_groups.push("sg1".into());
        phase.green_groups.push("sg2".into());
        assert_eq!(phase.green_groups.len(), 2);
    }
}
