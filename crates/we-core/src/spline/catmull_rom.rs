//! Catmull-Rom interpolation and tangent computation helpers.

/// Compute a Catmull-Rom tangent at position `i` from a list of positions.
///
/// For interior points: tangent = normalize(P[i+1] - P[i-1])
/// For endpoints: tangent = normalize(P[i+1] - P[i]) or normalize(P[i] - P[i-1])
///
/// Port of C# `UtilEditTangent.ComputeTangent`.
pub fn compute_catmull_rom_tangent(positions: &[[f64; 3]], i: usize) -> [f64; 3] {
    let n = positions.len();
    if n < 2 {
        return [1.0, 0.0, 0.0]; // default tangent
    }

    let (prev, next) = if i == 0 {
        // First point: use forward difference
        (positions[0], positions[1])
    } else if i >= n - 1 {
        // Last point: use backward difference
        (positions[n - 2], positions[n - 1])
    } else {
        // Interior point: use central difference (Catmull-Rom)
        (positions[i - 1], positions[i + 1])
    };

    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    let dz = next[2] - prev[2];
    let len = (dx * dx + dy * dy + dz * dz).sqrt();

    if len < 1e-12 {
        return [1.0, 0.0, 0.0];
    }

    [dx / len, dy / len, dz / len]
}
