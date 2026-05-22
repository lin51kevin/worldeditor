//! Road rendering configuration — mirrors C# `RoadLayerRenderConfig`.
//!
//! Provides per-type color palettes and visibility flags for lane lines,
//! surfaces, junction masks, etc.

use glam::Vec4;

/// Road layer rendering configuration.
#[derive(Debug, Clone)]
pub struct RoadRenderConfig {
    // ── Line colors ────────────────────────────────────────────────
    /// Color for normal lane lines.
    pub color_lane_line: Vec4,
    /// Color for selected/highlighted lane lines.
    pub color_lane_line_selected: Vec4,
    /// Center line color.
    pub color_center_line: Vec4,
    /// Selected center line color.
    pub color_center_line_selected: Vec4,
    /// Line highlight color (aqua in C#).
    pub color_line_highlighted: Vec4,

    // ── Object / signal colors ────────────────────────────────────
    pub color_object: Vec4,
    pub color_object_selected: Vec4,
    pub color_signal: Vec4,
    pub color_signal_selected: Vec4,

    // ── Surface colors (by lane type) ─────────────────────────────
    /// Drivable roadway surface.
    pub color_surface_drivable: Vec4,
    /// Sidewalk / footway surface.
    pub color_surface_sidewalk: Vec4,
    /// Shoulder surface.
    pub color_surface_shoulder: Vec4,
    /// Median / central reservation.
    pub color_surface_median: Vec4,
    /// Border surface.
    pub color_surface_border: Vec4,
    /// Any other lane type.
    pub color_surface_other: Vec4,

    // ── Junction colors ──────────────────────────────────────────
    pub color_junction_surface: Vec4,
    pub color_junction_surface_selected: Vec4,
    pub color_junction_gizmo: Vec4,
    pub color_junction_gizmo_selected: Vec4,
    pub color_junction_incoming_road: Vec4,
    pub color_junction_mask: Vec4,
    /// Alpha blend weight for junction mask surface.
    pub color_junction_mask_surface_weight: f32,
    pub color_junction_mask_wireframe_weight: f32,

    // ── Point colors ─────────────────────────────────────────────
    pub color_road_start_point: Vec4,
    pub color_road_start_point_selected: Vec4,
    pub color_road_end_point: Vec4,
    pub color_road_end_point_selected: Vec4,

    // ── Visibility toggles ───────────────────────────────────────
    pub show_center_line: bool,
    pub show_lane_line: bool,
    pub show_road_end_point: bool,
    pub show_object: bool,
    pub show_signal: bool,
    pub show_road_surface: bool,
    pub show_road_mark: bool,

    // ── Line geometry ────────────────────────────────────────────
    /// Lane line width in meters.
    pub lane_line_width: f32,
    /// Selected lane line width multiplier.
    pub selected_line_width_multiplier: f32,
    /// Dashed pattern: [dash_px, gap_px] in pixels.
    pub dashed_pattern_px: [f32; 2],
    /// Short dashed pattern: [dash_px, gap_px].
    pub short_dashed_pattern_px: [f32; 2],

    // ── Surface geometry ─────────────────────────────────────────
    /// Surface alpha (0..1, transparent).
    pub surface_alpha: f32,
    /// Z-offset for surfaces (avoids z-fighting).
    pub surface_z_offset: f32,
    /// Z-offset for lines.
    pub line_z_offset: f32,
}

impl Default for RoadRenderConfig {
    fn default() -> Self {
        Self {
            // Lines
            color_lane_line: Vec4::new(0.0, 0.0, 0.0, 1.0), // black
            color_lane_line_selected: Vec4::new(1.0, 0.0, 0.0, 1.0), // red
            color_center_line: Vec4::new(0.0, 0.0, 1.0, 1.0), // blue
            color_center_line_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),
            color_line_highlighted: Vec4::new(0.0, 1.0, 1.0, 1.0), // aqua

            // Objects / signals
            color_object: Vec4::new(0.0, 0.5, 0.0, 1.0), // green
            color_object_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),
            color_signal: Vec4::new(1.0, 0.0, 1.0, 1.0), // magenta
            color_signal_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),

            // Surfaces (from C# defaults)
            color_surface_drivable: Vec4::new(0.35, 0.35, 0.38, 0.3),
            color_surface_sidewalk: Vec4::new(0.55, 0.55, 0.50, 0.3),
            color_surface_shoulder: Vec4::new(0.30, 0.30, 0.28, 0.3),
            color_surface_median: Vec4::new(0.20, 0.35, 0.20, 0.3),
            color_surface_border: Vec4::new(0.25, 0.25, 0.25, 0.3),
            color_surface_other: Vec4::new(0.40, 0.40, 0.35, 0.3),

            // Junction
            color_junction_surface: Vec4::new(0.88, 0.85, 0.98, 0.65), // #e1d9fa
            color_junction_surface_selected: Vec4::new(1.0, 0.59, 0.59, 0.3),
            color_junction_gizmo: Vec4::new(0.65, 0.55, 0.94, 1.0),
            color_junction_gizmo_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),
            color_junction_incoming_road: Vec4::new(1.0, 0.0, 0.0, 1.0),
            color_junction_mask: Vec4::new(1.0, 1.0, 0.0, 0.5), // yellow
            color_junction_mask_surface_weight: 0.2,
            color_junction_mask_wireframe_weight: 0.4,

            // Points
            color_road_start_point: Vec4::new(0.14, 0.5, 0.5, 1.0), // dark cyan
            color_road_start_point_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),
            color_road_end_point: Vec4::new(0.0, 0.0, 1.0, 1.0),
            color_road_end_point_selected: Vec4::new(1.0, 0.0, 0.0, 1.0),

            // Visibility
            show_center_line: false,
            show_lane_line: true,
            show_road_end_point: false,
            show_object: true,
            show_signal: true,
            show_road_surface: true,
            show_road_mark: true,

            // Geometry
            lane_line_width: 0.15,
            selected_line_width_multiplier: 2.0,
            dashed_pattern_px: [16.0, 16.0],
            short_dashed_pattern_px: [8.0, 8.0],
            surface_alpha: 0.3,
            surface_z_offset: 0.001,
            line_z_offset: 0.002,
        }
    }
}

/// Lane line type (mirrors OpenDRIVE roadMark type).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LaneLineType {
    None,
    Solid,
    Broken,
    SolidBroken,
    BrokenSolid,
    BottsDots,
    Grass,
    Curb,
    Custom,
}

impl LaneLineType {
    /// Parse from OpenDRIVE mark_type string.
    pub fn from_opendrive(s: &str) -> Self {
        match s {
            "none" => LaneLineType::None,
            "solid" => LaneLineType::Solid,
            "broken" => LaneLineType::Broken,
            "solidBroken" => LaneLineType::SolidBroken,
            "brokenSolid" => LaneLineType::BrokenSolid,
            "bottsDots" => LaneLineType::BottsDots,
            "grass" => LaneLineType::Grass,
            "curb" => LaneLineType::Curb,
            _ => LaneLineType::Custom,
        }
    }

    /// Returns true if this line type should be drawn dashed.
    pub fn is_dashed(&self) -> bool {
        matches!(
            self,
            LaneLineType::Broken | LaneLineType::SolidBroken | LaneLineType::BrokenSolid
        )
    }
}

use std::hash::Hash;

/// Lane line color (mirrors OpenDRIVE roadMark color).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LaneLineColor {
    Standard, // maps to white (OpenDRIVE standard)
    White,
    Yellow,
    Red,
    Blue,
    Green,
    Orange,
    Violet,
    Custom,
}

impl LaneLineColor {
    /// Parse from OpenDRIVE color string.
    pub fn from_opendrive(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "standard" => LaneLineColor::Standard,
            "white" => LaneLineColor::White,
            "yellow" => LaneLineColor::Yellow,
            "red" => LaneLineColor::Red,
            "blue" => LaneLineColor::Blue,
            "green" => LaneLineColor::Green,
            "orange" => LaneLineColor::Orange,
            "violet" => LaneLineColor::Violet,
            _ => LaneLineColor::Custom,
        }
    }

    /// Convert to RGBA color value.
    pub fn to_rgba(&self) -> [f32; 4] {
        match self {
            LaneLineColor::Standard | LaneLineColor::White => [1.0, 1.0, 1.0, 1.0],
            LaneLineColor::Yellow => [1.0, 0.9, 0.0, 1.0],
            LaneLineColor::Red => [0.9, 0.1, 0.1, 1.0],
            LaneLineColor::Blue => [0.2, 0.4, 1.0, 1.0],
            LaneLineColor::Green => [0.2, 0.8, 0.2, 1.0],
            LaneLineColor::Orange => [1.0, 0.5, 0.1, 1.0],
            LaneLineColor::Violet => [0.7, 0.2, 0.8, 1.0],
            LaneLineColor::Custom => [0.5, 0.5, 0.5, 1.0],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec4;

    #[test]
    fn test_road_render_config_default() {
        let config = RoadRenderConfig::default();

        assert_eq!(config.color_lane_line, Vec4::new(0.0, 0.0, 0.0, 1.0));
        assert_eq!(
            config.color_lane_line_selected,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
        assert_eq!(config.color_center_line, Vec4::new(0.0, 0.0, 1.0, 1.0));
        assert_eq!(
            config.color_center_line_selected,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
        assert_eq!(config.color_line_highlighted, Vec4::new(0.0, 1.0, 1.0, 1.0));
        assert_eq!(config.color_object, Vec4::new(0.0, 0.5, 0.0, 1.0));
        assert_eq!(config.color_object_selected, Vec4::new(1.0, 0.0, 0.0, 1.0));
        assert_eq!(config.color_signal, Vec4::new(1.0, 0.0, 1.0, 1.0));
        assert_eq!(config.color_signal_selected, Vec4::new(1.0, 0.0, 0.0, 1.0));
        assert_eq!(
            config.color_surface_drivable,
            Vec4::new(0.35, 0.35, 0.38, 0.3)
        );
        assert_eq!(
            config.color_surface_sidewalk,
            Vec4::new(0.55, 0.55, 0.50, 0.3)
        );
        assert_eq!(
            config.color_surface_shoulder,
            Vec4::new(0.30, 0.30, 0.28, 0.3)
        );
        assert_eq!(
            config.color_surface_median,
            Vec4::new(0.20, 0.35, 0.20, 0.3)
        );
        assert_eq!(
            config.color_surface_border,
            Vec4::new(0.25, 0.25, 0.25, 0.3)
        );
        assert_eq!(config.color_surface_other, Vec4::new(0.40, 0.40, 0.35, 0.3));
        assert_eq!(
            config.color_junction_surface,
            Vec4::new(0.88, 0.85, 0.98, 0.65)
        );
        assert_eq!(
            config.color_junction_surface_selected,
            Vec4::new(1.0, 0.59, 0.59, 0.3)
        );
        assert_eq!(
            config.color_junction_gizmo,
            Vec4::new(0.65, 0.55, 0.94, 1.0)
        );
        assert_eq!(
            config.color_junction_gizmo_selected,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
        assert_eq!(
            config.color_junction_incoming_road,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
        assert_eq!(config.color_junction_mask, Vec4::new(1.0, 1.0, 0.0, 0.5));
        assert_eq!(config.color_junction_mask_surface_weight, 0.2);
        assert_eq!(config.color_junction_mask_wireframe_weight, 0.4);
        assert_eq!(
            config.color_road_start_point,
            Vec4::new(0.14, 0.5, 0.5, 1.0)
        );
        assert_eq!(
            config.color_road_start_point_selected,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
        assert_eq!(config.color_road_end_point, Vec4::new(0.0, 0.0, 1.0, 1.0));
        assert_eq!(
            config.color_road_end_point_selected,
            Vec4::new(1.0, 0.0, 0.0, 1.0)
        );
    }

    #[test]
    fn test_road_render_config_default_visibility() {
        let config = RoadRenderConfig::default();

        assert!(!config.show_center_line);
        assert!(config.show_lane_line);
        assert!(!config.show_road_end_point);
        assert!(config.show_object);
        assert!(config.show_signal);
        assert!(config.show_road_surface);
        assert!(config.show_road_mark);
    }

    #[test]
    fn test_road_render_config_default_geometry() {
        let config = RoadRenderConfig::default();

        assert_eq!(config.lane_line_width, 0.15);
        assert_eq!(config.selected_line_width_multiplier, 2.0);
        assert_eq!(config.dashed_pattern_px, [16.0, 16.0]);
        assert_eq!(config.short_dashed_pattern_px, [8.0, 8.0]);
        assert_eq!(config.surface_alpha, 0.3);
        assert_eq!(config.surface_z_offset, 0.001);
        assert_eq!(config.line_z_offset, 0.002);
    }

    #[test]
    fn test_lane_line_type_from_opendrive_all_variants() {
        let cases = [
            ("none", LaneLineType::None),
            ("solid", LaneLineType::Solid),
            ("broken", LaneLineType::Broken),
            ("solidBroken", LaneLineType::SolidBroken),
            ("brokenSolid", LaneLineType::BrokenSolid),
            ("bottsDots", LaneLineType::BottsDots),
            ("grass", LaneLineType::Grass),
            ("curb", LaneLineType::Curb),
        ];

        for (input, expected) in cases {
            assert_eq!(LaneLineType::from_opendrive(input), expected);
        }
    }

    #[test]
    fn test_lane_line_type_from_opendrive_unknown() {
        assert_eq!(
            LaneLineType::from_opendrive("doubleSolid"),
            LaneLineType::Custom
        );
    }

    #[test]
    fn test_lane_line_type_is_dashed() {
        for line_type in [
            LaneLineType::Broken,
            LaneLineType::SolidBroken,
            LaneLineType::BrokenSolid,
        ] {
            assert!(line_type.is_dashed());
        }
    }

    #[test]
    fn test_lane_line_type_is_not_dashed() {
        for line_type in [
            LaneLineType::None,
            LaneLineType::Solid,
            LaneLineType::BottsDots,
            LaneLineType::Grass,
            LaneLineType::Curb,
            LaneLineType::Custom,
        ] {
            assert!(!line_type.is_dashed());
        }
    }

    #[test]
    fn test_lane_line_color_from_opendrive_all_variants() {
        let cases = [
            ("standard", LaneLineColor::Standard),
            ("white", LaneLineColor::White),
            ("yellow", LaneLineColor::Yellow),
            ("red", LaneLineColor::Red),
            ("blue", LaneLineColor::Blue),
            ("green", LaneLineColor::Green),
            ("orange", LaneLineColor::Orange),
            ("violet", LaneLineColor::Violet),
        ];

        for (input, expected) in cases {
            assert_eq!(LaneLineColor::from_opendrive(input), expected);
        }
    }

    #[test]
    fn test_lane_line_color_from_opendrive_case_insensitive() {
        let cases = [
            ("WHITE", LaneLineColor::White),
            ("Yellow", LaneLineColor::Yellow),
            ("ReD", LaneLineColor::Red),
            ("bLuE", LaneLineColor::Blue),
            ("STANDARD", LaneLineColor::Standard),
        ];

        for (input, expected) in cases {
            assert_eq!(LaneLineColor::from_opendrive(input), expected);
        }
    }

    #[test]
    fn test_lane_line_color_from_opendrive_unknown() {
        assert_eq!(LaneLineColor::from_opendrive("pink"), LaneLineColor::Custom);
    }

    #[test]
    fn test_lane_line_color_to_rgba() {
        let cases = [
            (LaneLineColor::Standard, [1.0, 1.0, 1.0, 1.0]),
            (LaneLineColor::White, [1.0, 1.0, 1.0, 1.0]),
            (LaneLineColor::Yellow, [1.0, 0.9, 0.0, 1.0]),
            (LaneLineColor::Red, [0.9, 0.1, 0.1, 1.0]),
            (LaneLineColor::Blue, [0.2, 0.4, 1.0, 1.0]),
            (LaneLineColor::Green, [0.2, 0.8, 0.2, 1.0]),
            (LaneLineColor::Orange, [1.0, 0.5, 0.1, 1.0]),
            (LaneLineColor::Violet, [0.7, 0.2, 0.8, 1.0]),
            (LaneLineColor::Custom, [0.5, 0.5, 0.5, 1.0]),
        ];

        for (color, expected) in cases {
            assert_eq!(color.to_rgba(), expected);
        }
    }

    #[test]
    fn test_lane_line_color_standard_equals_white() {
        assert_eq!(
            LaneLineColor::Standard.to_rgba(),
            LaneLineColor::White.to_rgba()
        );
    }

    #[test]
    fn test_road_render_config_default_surface_palette_uses_surface_alpha() {
        let config = RoadRenderConfig::default();

        for color in [
            config.color_surface_drivable,
            config.color_surface_sidewalk,
            config.color_surface_shoulder,
            config.color_surface_median,
            config.color_surface_border,
            config.color_surface_other,
        ] {
            assert!((color.w - config.surface_alpha).abs() < 1e-6);
        }
    }

    #[test]
    fn test_road_render_config_default_line_dimensions_are_positive() {
        let config = RoadRenderConfig::default();

        assert!(config.lane_line_width > 0.0);
        assert!(config.selected_line_width_multiplier > 1.0);
        assert!(config.dashed_pattern_px.iter().all(|value| *value > 0.0));
        assert!(
            config
                .short_dashed_pattern_px
                .iter()
                .all(|value| *value > 0.0)
        );
        assert!(config.line_z_offset > config.surface_z_offset);
    }
}
