/// Select a lane surface color based on the active color mode.
pub(crate) fn select_lane_color(
    color_mode: &str,
    lane_type: we_core::model::LaneType,
    road_idx: usize,
) -> [f32; 4] {
    match color_mode {
        "single" => [0.45, 0.45, 0.45, 1.0],
        "byRoad" => road_hue_color(road_idx),
        _ => lane_surface_color(lane_type),
    }
}

/// Generate a distinct color for a road by cycling hue using the golden angle.
pub(crate) fn road_hue_color(road_idx: usize) -> [f32; 4] {
    let hue = (road_idx as f32 * 137.508) % 360.0;
    hsv_to_rgba(hue, 0.55, 0.62)
}

/// Convert HSV (h in degrees 0–360, s and v in 0–1) to RGBA (alpha = 1.0).
fn hsv_to_rgba(h: f32, s: f32, v: f32) -> [f32; 4] {
    let h6 = h / 60.0;
    let i = h6.floor() as u32 % 6;
    let f = h6 - h6.floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    let (r, g, b) = match i {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    [r, g, b, 1.0]
}

/// Lane surface color by lane type (RGBA).
pub(super) fn lane_surface_color(lane_type: we_core::model::LaneType) -> [f32; 4] {
    use we_core::model::LaneType;
    // Colors match C# WorldEditor reference: RoadConfig.cs
    match lane_type {
        LaneType::Driving => [0.298, 0.298, 0.298, 1.0], // (76,76,76)
        LaneType::Shoulder => [0.149, 0.149, 0.149, 1.0], // (38,38,38) near-black
        LaneType::Sidewalk => [0.725, 0.478, 0.341, 1.0], // (185,122,87) brown
        LaneType::Median => [0.463, 0.741, 0.400, 1.0],  // (118,189,102) green
        LaneType::Border => [0.741, 0.867, 0.745, 1.0],  // (189,221,190) pale green
        LaneType::Parking => [1.000, 0.808, 0.490, 1.0], // (255,206,125) warm yellow
        LaneType::Biking => [0.776, 0.702, 0.655, 1.0],  // (198,179,167) tan
        LaneType::Stop => [0.349, 0.788, 0.788, 1.0],    // (89,201,201) teal
        LaneType::Restricted => [0.639, 0.682, 0.773, 1.0], // (163,174,197) slate blue
        LaneType::Bidirectional => [0.812, 0.902, 0.961, 1.0], // (207,230,245) light blue
        LaneType::OffRamp => [0.878, 0.796, 0.796, 1.0], // (224,203,203) rose
        LaneType::OnRamp => [0.369, 0.565, 0.659, 1.0],  // (94,144,168) steel blue
        LaneType::ConnectingRamp => [0.027, 0.043, 0.314, 1.0], // (7,11,80) navy
        LaneType::Bus => [0.161, 0.141, 0.129, 1.0],     // (41,36,33) very dark
        LaneType::Taxi => [0.502, 0.541, 0.529, 1.0],    // (128,138,135) medium gray
        LaneType::HOV => [0.929, 0.569, 0.129, 1.0],     // (237,145,33) amber
        _ => [0.40, 0.40, 0.35, 1.0],
    }
}

/// Road mark color by mark color enum (RGBA).
pub(super) fn mark_color(color: we_core::model::RoadMarkColor) -> [f32; 4] {
    use we_core::model::RoadMarkColor;
    match color {
        RoadMarkColor::Yellow => [0.976, 0.827, 0.137, 1.0], // (249,211,35)
        RoadMarkColor::Red => [1.000, 0.000, 0.000, 1.0],
        RoadMarkColor::Blue => [0.000, 0.000, 1.000, 1.0],
        RoadMarkColor::Green => [0.000, 1.000, 0.000, 1.0],
        RoadMarkColor::Orange => [1.000, 0.380, 0.000, 1.0], // (255,97,0)
        RoadMarkColor::Violet => [0.580, 0.000, 0.827, 1.0],
        _ => [1.0, 1.0, 1.0, 1.0], // Standard / White
    }
}

/// Mark line width in meters according to OpenDRIVE weight (Standard = 0.15m, Bold = 0.25m).
pub(super) fn mark_line_width(rm: &we_core::model::RoadMark) -> f32 {
    if rm.width > 0.0 {
        return rm.width as f32;
    }
    use we_core::model::RoadMarkWeight;
    match rm.weight {
        RoadMarkWeight::Bold => 0.25,
        _ => 0.15,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        lane_surface_color, mark_color, mark_line_width, road_hue_color, select_lane_color,
    };
    use we_core::model::{LaneType, RoadMark, RoadMarkColor, RoadMarkType, RoadMarkWeight};

    fn road_mark(width: f64, weight: RoadMarkWeight) -> RoadMark {
        RoadMark {
            s_offset: 0.0,
            mark_type: RoadMarkType::Solid,
            weight,
            color: RoadMarkColor::Standard,
            material: String::new(),
            width,
            lane_change: String::new(),
            height: 0.0,
        }
    }

    #[test]
    fn test_select_lane_color_single_mode_returns_uniform_gray() {
        assert_eq!(
            select_lane_color("single", LaneType::Driving, 3),
            [0.45, 0.45, 0.45, 1.0]
        );
    }

    #[test]
    fn test_select_lane_color_by_road_matches_generated_hue() {
        assert_eq!(
            select_lane_color("byRoad", LaneType::Driving, 2),
            road_hue_color(2)
        );
    }

    #[test]
    fn test_road_hue_color_is_stable_and_opaque() {
        let color = road_hue_color(5);
        assert_eq!(color[3], 1.0);
        assert_ne!(color, road_hue_color(6));
    }

    #[test]
    fn test_lane_surface_and_mark_colors_match_expected_palette() {
        assert_eq!(
            lane_surface_color(LaneType::Driving),
            [0.298, 0.298, 0.298, 1.0]
        );
        assert_eq!(
            mark_color(RoadMarkColor::Yellow),
            [0.976, 0.827, 0.137, 1.0]
        );
    }

    #[test]
    fn test_mark_line_width_prefers_explicit_width_then_weight_defaults() {
        assert!(
            (mark_line_width(&road_mark(0.3, RoadMarkWeight::Standard)) - 0.3).abs() < f32::EPSILON
        );
        assert!(
            (mark_line_width(&road_mark(0.0, RoadMarkWeight::Bold)) - 0.25).abs() < f32::EPSILON
        );
        assert!(
            (mark_line_width(&road_mark(0.0, RoadMarkWeight::Standard)) - 0.15).abs()
                < f32::EPSILON
        );
    }
}
