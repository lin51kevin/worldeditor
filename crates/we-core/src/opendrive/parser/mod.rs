//! OpenDRIVE XML parser using quick-xml.
//!
//! Parses `.xodr` files into domain model types.

mod geometry;
mod header;
mod junction;
mod lane;
mod road;
mod signal;
mod structure;
mod utils;

use quick_xml::Reader;
use quick_xml::events::Event;

use super::OpenDriveError;
use crate::model::*;

/// Parse an OpenDRIVE XML string into a Project.
pub fn parse(xml: &str) -> Result<Project, OpenDriveError> {
    let mut reader = Reader::from_str(xml);
    let mut project = Project::default();
    // Pending objectReference entries: (road_index, ObjectRef)
    let mut pending_refs: Vec<(usize, signal::ObjectRef)> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"header" => {
                    project.header = header::parse_header(e, &mut reader)?;
                }
                b"road" => {
                    let (parsed_road, refs) = road::parse_road(e, &mut reader)?;
                    let road_idx = project.roads.len();
                    pending_refs.extend(refs.into_iter().map(|r| (road_idx, r)));
                    project.roads.push(parsed_road);
                }
                b"junction" => {
                    let junction = junction::parse_junction(e, &mut reader)?;
                    project.junctions.push(junction);
                }
                _ => {}
            },
            Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"header" {
                    project.header = header::parse_header_attrs(e)?;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(OpenDriveError::XmlError(e)),
            _ => {}
        }
    }

    // Resolve objectReferences: build a global id → cloned RoadObject map from all roads,
    // then attach copies (with the reference's s/t/z_offset) to each referencing road.
    if !pending_refs.is_empty() {
        let obj_map: std::collections::HashMap<String, RoadObject> = project
            .roads
            .iter()
            .flat_map(|r| r.objects.iter())
            .map(|o| (o.id.clone(), o.clone()))
            .collect();

        for (road_idx, obj_ref) in pending_refs {
            // Skip references outside the valid road range — negative s or past road end
            // (e.g. some XODR files have objectReference with s < 0 for adjacent-road alignment
            // data that doesn't belong on this road).
            let road_length = project.roads[road_idx].length;
            if obj_ref.s < 0.0 || (road_length > 0.0 && obj_ref.s > road_length + 1.0) {
                continue;
            }

            if let Some(template) = obj_map.get(&obj_ref.id) {
                let mut copy = template.clone();
                copy.position.x = obj_ref.s;
                copy.position.y = obj_ref.t;
                copy.position.z = obj_ref.z_offset;
                copy.from_object_ref = true;
                project.roads[road_idx].objects.push(copy);
            } else {
                log::warn!(
                    "objectReference id='{}' not found in any road — skipping",
                    obj_ref.id
                );
            }
        }
    }

    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that `<roadMark>` elements with child elements are parsed correctly.
    /// This is the fix for the bug where Start events for roadMark/width/border
    /// were silently skipped instead of having their attributes parsed.
    #[test]
    fn test_parse_road_mark_with_children_is_parsed() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center>
          <lane id="0" type="none" level="false"/>
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0" a="3.5" b="0" c="0" d="0"/>
            <roadMark sOffset="0" type="solid" color="standard" weight="standard" width="0.13">
              <type name="solid" width="0.13">
                <line length="0" space="0" width="0.13" sOffset="0" rule="no passing" color="standard"/>
              </type>
            </roadMark>
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        assert_eq!(project.roads.len(), 1);
        let road = &project.roads[0];
        assert_eq!(road.lane_sections.len(), 1);

        let section = &road.lane_sections[0];
        assert_eq!(section.right.len(), 1);
        let lane = &section.right[0];

        // The roadMark with child elements must be parsed (not skipped)
        assert_eq!(lane.road_marks.len(), 1, "roadMark with child <type> element must be parsed");
        assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
        assert!((lane.road_marks[0].width - 0.13).abs() < 1e-6);

        // The width element with no children should still work
        assert_eq!(lane.width.len(), 1);
        assert!((lane.width[0].a - 3.5).abs() < 1e-6);
    }

    #[test]
    fn test_parse_road_mark_self_closing_still_works() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="50" id="2" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="50">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center>
          <lane id="0" type="none" level="false"/>
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <roadMark sOffset="0" type="broken" color="yellow" width="0.12"/>
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        let lane = &project.roads[0].lane_sections[0].right[0];
        assert_eq!(lane.road_marks.len(), 1);
        assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Broken);
        assert_eq!(lane.road_marks[0].color, RoadMarkColor::Yellow);
    }

    #[test]
    fn test_parse_signals_self_closing() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <signals>
      <signal s="30" t="0" id="sig1" name="arrow" zOffset="0" hOffset="3.14159"
              type="Graphics" subtype="StraightAheadArrow" dynamic="no"
              orientation="+" width="3" height="0"/>
    </signals>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        assert_eq!(project.roads[0].signals.len(), 1);
        let sig = &project.roads[0].signals[0];
        assert_eq!(sig.id, "sig1");
        assert!((sig.s - 30.0).abs() < 1e-6);
        assert_eq!(sig.signal_type, "Graphics");
        assert_eq!(sig.signal_subtype, "StraightAheadArrow");
        assert!((sig.h_offset - std::f64::consts::PI).abs() < 1e-4);
        assert!((sig.width - 3.0).abs() < 1e-6);
        assert!(!sig.is_dynamic);
    }

    #[test]
    fn test_parse_signals_with_children() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="100" id="2" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <signals>
      <signal s="50" t="-2" id="sig2" name="speed" zOffset="3" hOffset="0"
              type="1010203800001413" subtype="none" dynamic="no"
              orientation="-" width="0.6" height="0.6" value="30">
        <validity fromLane="-1" toLane="-1"/>
      </signal>
    </signals>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        assert_eq!(project.roads[0].signals.len(), 1);
        let sig = &project.roads[0].signals[0];
        assert_eq!(sig.id, "sig2");
        assert!((sig.s - 50.0).abs() < 1e-6);
        assert_eq!(sig.signal_type, "1010203800001413");
        assert_eq!(sig.value.as_deref(), Some("30"));
        assert_eq!(sig.orientation, "-");
    }

    #[test]
    fn test_parse_objects_self_closing() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <roadObject id="1" name="pole" s="10.0" t="-3.5" zOffset="0.0" type="pole"
                   orientation="none" length="0.1" width="0.1" height="2.0" hdg="0.0"/>
      <roadObject id="2" name="barrier" s="50.0" t="2.0" zOffset="0.0" type="barrier"
                   orientation="-" width="0.5" height="1.0"/>
    </objects>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        let road = &project.roads[0];
        assert_eq!(road.objects.len(), 2);

        let obj0 = &road.objects[0];
        assert_eq!(obj0.id, "1");
        assert_eq!(obj0.name, "pole");
        assert_eq!(obj0.object_type, ObjectType::Pillar);
        assert!((obj0.position.x - 10.0).abs() < 1e-6);
        assert!((obj0.position.y - (-3.5)).abs() < 1e-6);
        assert!((obj0.position.z).abs() < 1e-6);
        assert!((obj0.width - 0.1).abs() < 1e-6);
        assert!((obj0.height - 2.0).abs() < 1e-6);
        assert!((obj0.orientation).abs() < 1e-6);
        assert!(obj0.validity.is_none());

        let obj1 = &road.objects[1];
        assert_eq!(obj1.id, "2");
        assert_eq!(obj1.object_type, ObjectType::Barrier);
        assert!((obj1.orientation - 180.0).abs() < 1e-6);
    }

    #[test]
    fn test_parse_objects_with_validity() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="test" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <roadObject id="1" name="guard" s="20.0" t="0.0" zOffset="0.0" type="guardrail"
                   orientation="none" width="0.3" height="0.8">
        <validity fromLane="-2" toLane="2"/>
      </roadObject>
    </objects>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        let road = &project.roads[0];
        assert_eq!(road.objects.len(), 1);
        let obj = &road.objects[0];
        assert_eq!(obj.object_type, ObjectType::Guardrail);
        assert!((obj.position.x - 20.0).abs() < 1e-6);
        let val = obj.validity.as_ref().unwrap();
        assert_eq!(val.from_lane, -2);
        assert_eq!(val.to_lane, 2);
    }

    /// Object type matching is case-insensitive:
    /// the XODR file uses `type="stopline"` (all lowercase), which must map to ObjectType::StopLine.
    #[test]
    fn test_parse_object_type_case_insensitive() {
        let xml = |type_str: &str| {
            format!(
                r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="r" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <object id="1" name="x" s="10" t="0" zOffset="0" type="{type_str}" orientation="none"
              length="0" width="0" radius="0" height="0" hdg="0"/>
    </objects>
  </road>
</OpenDRIVE>"#
            )
        };

        for variant in &["stopline", "StopLine", "STOPLINE", "stopLine"] {
            let project = parse(&xml(variant)).expect("parse should succeed");
            assert_eq!(
                project.roads[0].objects[0].object_type,
                ObjectType::StopLine,
                "variant '{}' should map to StopLine",
                variant
            );
        }

        for variant in &["crosswalk", "Crosswalk", "CROSSWALK", "CrossWalk"] {
            let project = parse(&xml(variant)).expect("parse should succeed");
            assert_eq!(
                project.roads[0].objects[0].object_type,
                ObjectType::Crosswalk,
                "variant '{}' should map to Crosswalk",
                variant
            );
        }
    }

    /// The `hdg` attribute on `<object>` / `<roadObject>` is stored in `RoadObject.hdg`.
    #[test]
    fn test_parse_object_hdg_attribute() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="r" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <object id="17" name="Zebra" s="50" t="0" zOffset="0" type="crosswalk" orientation="none"
              length="0" width="0" radius="0" height="0" hdg="1.5707963267949">
        <outline>
          <cornerLocal u="-1" v="-1" height="0" z="0"/>
          <cornerLocal u="2"  v="-1" height="0" z="0"/>
          <cornerLocal u="2"  v="-3" height="0" z="0"/>
          <cornerLocal u="-1" v="-3" height="0" z="0"/>
        </outline>
      </object>
    </objects>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");
        let obj = &project.roads[0].objects[0];
        assert_eq!(obj.object_type, ObjectType::Crosswalk);
        assert!((obj.hdg - std::f64::consts::FRAC_PI_2).abs() < 1e-9, "hdg must be π/2");
        assert_eq!(obj.corners.len(), 4);
    }

    /// `<objectReference>` elements are resolved into copies of the original object,
    /// positioned at (s, t) on the referencing road.
    #[test]
    fn test_parse_object_reference_resolution() {
        let xml = r#"<?xml version="1.0"?>
<OpenDRIVE>
  <road name="main" length="100" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <object id="42" name="Crosswalk" s="50" t="0" zOffset="0" type="crosswalk" orientation="none"
              length="0" width="0" radius="0" height="0" hdg="1.5707963267949">
        <outline>
          <cornerLocal u="-1" v="-1" height="0" z="0"/>
          <cornerLocal u="2"  v="-1" height="0" z="0"/>
          <cornerLocal u="2"  v="-3" height="0" z="0"/>
          <cornerLocal u="-1" v="-3" height="0" z="0"/>
        </outline>
      </object>
    </objects>
  </road>
  <road name="connector" length="20" id="2" junction="99">
    <planView>
      <geometry s="0" x="100" y="0" hdg="0" length="20">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <objectReference id="42" s="10" t="1.5" zOffset="0.01" orientation="none" validLength="0"/>
    </objects>
  </road>
</OpenDRIVE>"#;

        let project = parse(xml).expect("parse should succeed");

        // Road 1: original object
        assert_eq!(project.roads[0].objects.len(), 1);
        let original = &project.roads[0].objects[0];
        assert_eq!(original.id, "42");
        assert!((original.position.x - 50.0).abs() < 1e-6);

        // Road 2: resolved copy with the reference's s/t/z_offset
        assert_eq!(project.roads[1].objects.len(), 1, "objectReference must be resolved into an object");
        let copy = &project.roads[1].objects[0];
        assert_eq!(copy.id, "42", "copy must have the same id as original");
        assert_eq!(copy.object_type, ObjectType::Crosswalk);
        assert!((copy.position.x - 10.0).abs() < 1e-6, "s must be from objectReference");
        assert!((copy.position.y - 1.5).abs() < 1e-6, "t must be from objectReference");
        assert!((copy.position.z - 0.01).abs() < 1e-6, "zOffset must be from objectReference");
        // Corners and hdg must be inherited from the original
        assert_eq!(copy.corners.len(), 4, "corners must be copied from original");
        assert!((copy.hdg - std::f64::consts::FRAC_PI_2).abs() < 1e-9, "hdg must be copied from original");
        // The copy must be flagged so the renderer skips it (avoids ghost stalls)
        assert!(copy.from_object_ref, "objectReference copy must have from_object_ref=true");
        // The original must NOT be flagged
        assert!(!original.from_object_ref, "original object must have from_object_ref=false");
    }
}
