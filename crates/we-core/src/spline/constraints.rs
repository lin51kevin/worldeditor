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

#[cfg(test)]
mod tests {
    use super::*;

    fn d() -> [f64; 3] {
        [3.0, 5.0, 7.0]
    }

    #[test]
    fn test_constrain_free_preserves_all() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::Free), [3.0, 5.0, 7.0]);
    }

    #[test]
    fn test_constrain_x_axis() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::XAxis), [3.0, 0.0, 0.0]);
    }

    #[test]
    fn test_constrain_y_axis() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::YAxis), [0.0, 5.0, 0.0]);
    }

    #[test]
    fn test_constrain_z_axis() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::ZAxis), [0.0, 0.0, 7.0]);
    }

    #[test]
    fn test_constrain_xy_plane() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::XyPlane), [3.0, 5.0, 0.0]);
    }

    #[test]
    fn test_constrain_xz_plane() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::XzPlane), [3.0, 0.0, 7.0]);
    }

    #[test]
    fn test_constrain_yz_plane() {
        assert_eq!(constrain_displacement(d(), MoveConstraint::YzPlane), [0.0, 5.0, 7.0]);
    }

    #[test]
    fn test_constrain_zero_displacement_all_variants() {
        let zero = [0.0, 0.0, 0.0];
        for constraint in [
            MoveConstraint::Free,
            MoveConstraint::XAxis,
            MoveConstraint::YAxis,
            MoveConstraint::ZAxis,
            MoveConstraint::XyPlane,
            MoveConstraint::XzPlane,
            MoveConstraint::YzPlane,
        ] {
            assert_eq!(
                constrain_displacement(zero, constraint),
                zero,
                "failed for {constraint:?}"
            );
        }
    }

    #[test]
    fn test_move_constraint_is_serializable() {
        let json = serde_json::to_string(&MoveConstraint::XyPlane).unwrap();
        let back: MoveConstraint = serde_json::from_str(&json).unwrap();
        assert_eq!(back, MoveConstraint::XyPlane);
    }
}
