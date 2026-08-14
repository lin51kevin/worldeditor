//! Minimum on-screen line width enforcement.
//!
//! Several thin surface elements (lane marks, crosswalk/hatch stripes, area
//! outlines, stop/yield lines) are only ~0.1-0.45 m wide in world space. With
//! MSAA disabled (see `rendererResources.ts`), a single-sample rasterizer can
//! drop triangles that shrink below one screen pixel at low zoom, leaving gaps
//! in otherwise-continuous lines. The frontend calls [`set_min_line_width_m`]
//! whenever the viewport's meters-per-pixel changes, so thin geometry
//! generators can widen themselves just enough to stay visible.

use std::cell::Cell;
use wasm_bindgen::prelude::*;

thread_local! {
    static MIN_LINE_WIDTH_M: Cell<f64> = const { Cell::new(0.0) };
}

/// Ceiling on the enforced width itself (metres). The requested width scales
/// linearly with meters-per-pixel, which is unbounded as the view zooms out
/// further and further; without a ceiling, far enough out the "minimum" width
/// would grow past the width of the very road/feature it marks, making thin
/// lines look like an oversized solid blob instead of shrinking normally.
/// Capped near the widest native stripe width (crosswalk/hatch, 0.45 m) so
/// the clamp never visibly outgrows real geometry, at the cost of allowing
/// (already-negligible-at-that-zoom) coverage gaps past this point.
const MAX_MIN_LINE_WIDTH_M: f64 = 0.5;

/// Set the minimum world-space width (in metres) applied to thin line and
/// stripe geometry (lane marks, crosswalk/hatch stripes, area outlines,
/// stop/yield lines) so they don't shrink below the rasterizer's
/// single-sample coverage at low zoom. Pass `0` to disable clamping (the
/// default). Clamped to [`MAX_MIN_LINE_WIDTH_M`] so an extreme zoom-out
/// doesn't inflate thin geometry past that ceiling.
#[wasm_bindgen]
pub fn set_min_line_width_m(width_m: f64) {
    MIN_LINE_WIDTH_M.with(|w| w.set(width_m.clamp(0.0, MAX_MIN_LINE_WIDTH_M)));
}

/// Current minimum line width in metres (`0` = no clamping).
pub(super) fn min_line_width_m() -> f64 {
    MIN_LINE_WIDTH_M.with(|w| w.get())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_min_line_width_m_rounds_trips_and_floors_at_zero() {
        set_min_line_width_m(0.2);
        assert_eq!(min_line_width_m(), 0.2);
        set_min_line_width_m(-1.0);
        assert_eq!(min_line_width_m(), 0.0);
        // Restore the default so other tests on a pooled thread aren't affected.
        set_min_line_width_m(0.0);
    }

    #[test]
    fn set_min_line_width_m_caps_at_max_so_far_zoom_out_does_not_inflate_lines() {
        set_min_line_width_m(1000.0);
        assert_eq!(min_line_width_m(), MAX_MIN_LINE_WIDTH_M);
        set_min_line_width_m(0.0);
    }
}
