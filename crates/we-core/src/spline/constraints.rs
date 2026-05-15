//! Constraint system for gizmo-based knot movement.
//!
//! Port of C# `SplineKnotsFrame.EConstrain`.

use serde::{Deserialize, Serialize};

/// Constraint axis for gizmo-based movement.
///
/// Port of C# `SplineKnotsFrame.EConstrain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MoveConstraint {
    /// Free movement (no constraint).
    Free,
    /// Constrain to X axis only.
    XAxis,
    /// Constrain to Y axis only.
    YAxis,
    /// Constrain to Z axis only.
    ZAxis,
    /// Constrain to XY plane (horizontal).
    XyPlane,
    /// Constrain to XZ plane.
    XzPlane,
    /// Constrain to YZ plane.
    YzPlane,
}

/// Apply a movement constraint to a displacement vector.
///
/// Zeroes out components that are not part of the constraint.
pub fn constrain_displacement(displacement: [f64; 3], constraint: MoveConstraint) -> [f64; 3] {
    match constraint {
        MoveConstraint::Free => displacement,
        MoveConstraint::XAxis => [displacement[0], 0.0, 0.0],
        MoveConstraint::YAxis => [0.0, displacement[1], 0.0],
        MoveConstraint::ZAxis => [0.0, 0.0, displacement[2]],
        MoveConstraint::XyPlane => [displacement[0], displacement[1], 0.0],
        MoveConstraint::XzPlane => [displacement[0], 0.0, displacement[2]],
        MoveConstraint::YzPlane => [0.0, displacement[1], displacement[2]],
    }
}
