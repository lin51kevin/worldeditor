use serde::{Deserialize, Deserializer};

/// Deserialize a bare `f64` field that may arrive as JSON `null`.
/// Treats `null` (or a missing key when combined with `#[serde(default)]`) as `0.0`.
pub fn f64_or_zero<'de, D>(d: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<f64>::deserialize(d).map(|opt| opt.unwrap_or(0.0))
}
