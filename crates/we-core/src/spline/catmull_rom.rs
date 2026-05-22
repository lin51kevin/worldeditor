//! Catmull-Rom interpolation and tangent computation helpers.

/// Compute a smooth tangent at position  from a list of positions.
///
/// **Formula**: bisector of unit in/out segment vectors, matching C# .
///
/// Interior knots: .
/// Endpoint knots: single adjacent segment direction.
///
/// Port of C#  / .
pub fn compute_catmull_rom_tangent(positions: &[[f64; 3]], i: usize) -> [f64; 3] {
    let n = positions.len();
    if n < 2 {
        return [1.0, 0.0, 0.0];
    }

    // Endpoints: use the single adjacent segment direction.
    if i == 0 {
        return unit_dir(positions[0], positions[1]);
    }
    if i >= n - 1 {
        return unit_dir(positions[n - 2], positions[n - 1]);
    }

    // Interior: bisector of the two adjacent unit directions (C# formula).
    let pre_dir = unit_dir(positions[i - 1], positions[i]);
    let next_dir = unit_dir(positions[i], positions[i + 1]);

    let bx = pre_dir[0] + next_dir[0];
    let by = pre_dir[1] + next_dir[1];
    let bz = pre_dir[2] + next_dir[2];
    let len = (bx * bx + by * by + bz * bz).sqrt();

    if len < 1e-12 {
        // Hairpin: in/out directions cancel -- fall back to forward direction.
        return next_dir;
    }

    [bx / len, by / len, bz / len]
}

/// Normalize the direction vector from  to .
/// Returns a safe unit vector (falls back to +X on degenerate input).
#[inline]
fn unit_dir(from: [f64; 3], to: [f64; 3]) -> [f64; 3] {
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let dz = to[2] - from[2];
    let len = (dx * dx + dy * dy + dz * dz).sqrt();
    if len < 1e-12 {
        [1.0, 0.0, 0.0]
    } else {
        [dx / len, dy / len, dz / len]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_pair_returns_forward_direction() {
        let pts = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]];
        let t = compute_catmull_rom_tangent(&pts, 0);
        let ok = (t[0] - 1.0).abs() < 1e-10 && t[1].abs() < 1e-10;
        assert!(ok, "expected [1,0,0], got {:?}", t);
    }

    #[test]
    fn test_uniform_spacing_straight_line() {
        let pts = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [3.0, 0.0, 0.0],
        ];
        for i in 0..pts.len() {
            let t = compute_catmull_rom_tangent(&pts, i);
            let ok = (t[0] - 1.0).abs() < 1e-10;
            assert!(ok, "i={} expected +X tangent, got {:?}", i, t);
        }
    }

    #[test]
    fn test_90_degree_turn_bisector() {
        // pre_dir=[1,0,0], next_dir=[0,1,0] => bisector=[1/sqrt2, 1/sqrt2, 0]
        let pts = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0]];
        let t = compute_catmull_rom_tangent(&pts, 1);
        let expected = 1.0_f64 / 2.0_f64.sqrt();
        let ok = (t[0] - expected).abs() < 1e-10 && (t[1] - expected).abs() < 1e-10;
        assert!(ok, "expected bisector, got {:?}", t);
    }

    #[test]
    fn test_non_uniform_spacing_equal_angular_weight() {
        // Short segment up (len=1), long segment right (len=100).
        // Central-diff gives ~[1,0,0]; bisector gives [1/sqrt2, 1/sqrt2, 0].
        let pts = [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [100.0, 1.0, 0.0]];
        let t = compute_catmull_rom_tangent(&pts, 1);
        let expected = 1.0_f64 / 2.0_f64.sqrt();
        let ok = (t[0] - expected).abs() < 1e-10 && (t[1] - expected).abs() < 1e-10;
        assert!(ok, "expected equal-weight bisector, got {:?}", t);
    }

    #[test]
    fn test_result_is_unit_length() {
        let pts = [
            [0.0, 0.0, 0.0],
            [3.0, 4.0, 0.0],
            [10.0, 2.0, 0.0],
            [15.0, 8.0, 0.0],
        ];
        for i in 0..pts.len() {
            let t = compute_catmull_rom_tangent(&pts, i);
            let mag = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2]).sqrt();
            let ok = (mag - 1.0).abs() < 1e-10;
            assert!(ok, "i={} not unit length, mag={}", i, mag);
        }
    }
}
