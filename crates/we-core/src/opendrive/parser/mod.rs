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

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"header" => {
                    project.header = header::parse_header(e, &mut reader)?;
                }
                b"road" => {
                    let road = road::parse_road(e, &mut reader)?;
                    project.roads.push(road);
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

    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::road::*;

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
}
