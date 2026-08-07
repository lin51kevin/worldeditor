//! Colour and outline-width table for road objects.
//!
//! Mirrors the `[ObjectType(r, g, b, Name, LineWidth)]` attributes of the legacy
//! C# editor's `ObjectConfig`, so both editors paint the same map. Types the C#
//! editor has no entry for fall back to its `Unknown` colour (bright green),
//! which is exactly what it would display for them.

use we_core::model::ObjectType;

/// C# `ObjectConfig.smNormalMarkWidth` — the stroke width every object outline
/// uses unless its type declares its own.
pub(crate) const DEFAULT_LINE_WIDTH: f64 = 0.1;

/// C# `ObjectConfig.smColorOutline` (`Unknown`).
const UNKNOWN: [f32; 4] = [0.000, 1.000, 0.000, 1.0];

const fn rgb(r: u8, g: u8, b: u8) -> [f32; 4] {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0]
}

/// Outline / fill colour for a road object type.
pub(crate) fn object_color(object_type: &ObjectType) -> [f32; 4] {
    match object_type {
        ObjectType::StopLine | ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => {
            rgb(255, 255, 255)
        }
        ObjectType::Crosswalk => rgb(0, 0, 128),
        ObjectType::ParkingSpace => rgb(108, 140, 71),
        ObjectType::CrossHatchArea => rgb(246, 166, 35),
        ObjectType::SimpleCrossHatch => rgb(245, 166, 35),
        // C# paints woven areas hot pink (255, 13, 166); this editor
        // deliberately shares the cross-hatch palette, so only the stripe
        // direction tells the two apart.
        ObjectType::WovenArea => rgb(246, 166, 35),
        ObjectType::SlowDownToYieldLine => rgb(0, 191, 255),
        ObjectType::StopToYieldLine => rgb(208, 2, 27),
        ObjectType::Guardrail => rgb(44, 44, 44),
        ObjectType::Curb => rgb(255, 109, 0),
        ObjectType::FlowerBed => rgb(144, 19, 254),
        ObjectType::SidewalkRail => rgb(102, 255, 0),
        ObjectType::TrashBin => rgb(255, 117, 155),
        ObjectType::SimpleSignalPole => rgb(0, 255, 255),
        ObjectType::TrafficLightPole => rgb(102, 64, 255),
        ObjectType::StreetLightPole => rgb(156, 141, 214),
        ObjectType::SignGantry => rgb(18, 116, 54),
        ObjectType::LTypeSignalPole => rgb(128, 0, 0),
        ObjectType::TTypeSignalPole => rgb(128, 0, 128),
        ObjectType::Pillar => rgb(0, 255, 0),
        ObjectType::Pole => rgb(50, 205, 50),
        ObjectType::Bridge => rgb(220, 220, 220),
        ObjectType::Tunnel => rgb(148, 148, 148),
        ObjectType::Sign
        | ObjectType::Barrier
        | ObjectType::Wall
        | ObjectType::TrafficCone
        | ObjectType::Custom(_) => UNKNOWN,
    }
}

/// Outline stroke width in metres (C# `ObjectTypeAttribute.LineWidth`).
pub(crate) fn object_line_width(object_type: &ObjectType) -> f64 {
    match object_type {
        ObjectType::StopLine => 0.4,
        ObjectType::Bridge | ObjectType::Tunnel => 0.5,
        _ => DEFAULT_LINE_WIDTH,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_object_color_matches_csharp_table() {
        assert_eq!(object_color(&ObjectType::Crosswalk), rgb(0, 0, 128));
        assert_eq!(object_color(&ObjectType::LTypeSignalPole), rgb(128, 0, 0));
        assert_eq!(object_color(&ObjectType::TTypeSignalPole), rgb(128, 0, 128));
        assert_eq!(object_color(&ObjectType::Pillar), rgb(0, 255, 0));
        assert_eq!(object_color(&ObjectType::Pole), rgb(50, 205, 50));
        assert_eq!(object_color(&ObjectType::Curb), rgb(255, 109, 0));
        assert_eq!(object_color(&ObjectType::FlowerBed), rgb(144, 19, 254));
        assert_eq!(object_color(&ObjectType::SidewalkRail), rgb(102, 255, 0));
        assert_eq!(object_color(&ObjectType::TrashBin), rgb(255, 117, 155));
        assert_eq!(object_color(&ObjectType::Guardrail), rgb(44, 44, 44));
        assert_eq!(object_color(&ObjectType::SignGantry), rgb(18, 116, 54));
    }

    #[test]
    fn test_types_without_a_csharp_entry_use_unknown_green() {
        for t in [
            ObjectType::Sign,
            ObjectType::Barrier,
            ObjectType::Wall,
            ObjectType::TrafficCone,
            ObjectType::Custom("whatever".into()),
        ] {
            assert_eq!(object_color(&t), UNKNOWN, "{t:?}");
        }
    }

    #[test]
    fn test_object_line_width_overrides() {
        assert!((object_line_width(&ObjectType::StopLine) - 0.4).abs() < 1e-9);
        assert!((object_line_width(&ObjectType::Bridge) - 0.5).abs() < 1e-9);
        assert!((object_line_width(&ObjectType::Tunnel) - 0.5).abs() < 1e-9);
        assert!((object_line_width(&ObjectType::Crosswalk) - DEFAULT_LINE_WIDTH).abs() < 1e-9);
    }

    #[test]
    fn test_every_color_is_opaque_and_in_unit_range() {
        for t in [
            ObjectType::Sign,
            ObjectType::Guardrail,
            ObjectType::Barrier,
            ObjectType::Curb,
            ObjectType::Wall,
            ObjectType::Pillar,
            ObjectType::TrafficCone,
            ObjectType::ParkingSpace,
            ObjectType::Crosswalk,
            ObjectType::StopLine,
            ObjectType::CrossHatchArea,
            ObjectType::WovenArea,
            ObjectType::ForwardWaitingArea,
            ObjectType::TurnLeftWaitingArea,
            ObjectType::SlowDownToYieldLine,
            ObjectType::StopToYieldLine,
            ObjectType::SimpleSignalPole,
            ObjectType::TrafficLightPole,
            ObjectType::StreetLightPole,
            ObjectType::SignGantry,
            ObjectType::LTypeSignalPole,
            ObjectType::TTypeSignalPole,
            ObjectType::Pole,
            ObjectType::SidewalkRail,
            ObjectType::FlowerBed,
            ObjectType::TrashBin,
            ObjectType::SimpleCrossHatch,
            ObjectType::Bridge,
            ObjectType::Tunnel,
            ObjectType::Custom(String::new()),
        ] {
            let c = object_color(&t);
            assert!((c[3] - 1.0).abs() < 1e-9, "{t:?} must be opaque");
            assert!(c[..3].iter().all(|v| (0.0..=1.0).contains(v)), "{t:?}");
            assert!(object_line_width(&t) > 0.0, "{t:?}");
        }
    }
}
