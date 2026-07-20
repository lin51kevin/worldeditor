/**
 * GeoZ protobuf-decoded intermediate types.
 *
 * These interfaces mirror the structure of the bundled `.proto` schemas after
 * protobufjs decoding: keep-case field names, all fields optional + nullable.
 * They are the input shape consumed by the GeoZ parser conversion functions.
 */

import type { Road, RoadObjectItem, RoadSignal } from '../../../services/platform';

export type ProtoEnum = number | string | null | undefined;

export interface ProtoPoint3D {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

export interface ProtoRoadBoundary {
  point?: ProtoPoint3D[] | null;
}

export interface ProtoLaneBoundary {
  point?: ProtoPoint3D[] | null;
  road_mark?: ProtoRoadMark[] | null;
}

export interface ProtoRoadMark {
  offset?: number | null;
  length?: number | null;
  mark_type?: ProtoEnum;
  mark_color?: ProtoEnum;
  mark_weight?: ProtoEnum;
  width?: number | null;
}

export interface ProtoLaneGeometry {
  id?: string | null;
  left_boundary?: ProtoLaneBoundary | null;
  right_boundary?: ProtoLaneBoundary | null;
  center_boundary?: ProtoLaneBoundary | null;
}

export interface ProtoRoadGeometry {
  id?: string | null;
  reference_line?: ProtoRoadBoundary | null;
  center_line?: ProtoRoadBoundary | null;
  lane_geometrys?: ProtoLaneGeometry[] | null;
}

export interface ProtoTileRoadFile {
  road_geometry?: ProtoRoadGeometry | null;
}

export interface ProtoLaneLink {
  id?: string | null;
}

export interface ProtoLaneHeader {
  id?: string | null;
  length?: number | null;
  lane_type?: ProtoEnum;
  virtual_type?: ProtoEnum;
  name?: string | null;
}

export interface ProtoLaneTopo {
  header?: ProtoLaneHeader | null;
  predecessors?: ProtoLaneLink[] | null;
  successors?: ProtoLaneLink[] | null;
}

export interface ProtoRoadlink {
  id?: string | null;
  s?: number | null;
  link_type?: ProtoEnum;
  link_contact_point?: ProtoEnum;
}

export interface ProtoRoadSection {
  section_id?: string | null;
  section_index?: number | null;
  s?: number | null;
  length?: number | null;
  section_direction_type?: ProtoEnum;
  lanes?: ProtoLaneTopo[] | null;
}

export interface ProtoSignalValidity {
  road_id?: string | null;
  from_lane_id?: string | null;
  to_lane_id?: string | null;
}

export interface ProtoPropertie {
  name?: string | null;
  value?: string | null;
}

export interface ProtoSignal {
  id?: string | null;
  type?: string | null;
  sub_type?: string | null;
  road_id?: string | null;
  pt?: ProtoPoint3D | null;
  heading?: ProtoPoint3D | null;
  value?: string | null;
  unit?: string | null;
  dynamic?: boolean | null;
  width?: number | null;
  length?: number | null;
  height?: number | null;
  validities?: ProtoSignalValidity[] | null;
  userDataList?: ProtoPropertie[] | null;
}

export interface ProtoObject {
  id?: string | null;
  type?: string | null;
  sub_type?: string | null;
  road_id?: string | null;
  pt?: ProtoPoint3D | null;
  heading?: ProtoPoint3D | null;
  up?: ProtoPoint3D | null;
  boundary_knots?: ProtoPoint3D[] | null;
  userDataList?: ProtoPropertie[] | null;
}

export interface ProtoParkingSpace {
  obj?: ProtoObject | null;
}

export interface ProtoRoadHeader {
  id?: string | null;
  length?: number | null;
  name?: string | null;
  junction_id?: string | null;
}

export interface ProtoRoadTopo {
  header?: ProtoRoadHeader | null;
  road_predecessors?: ProtoRoadlink[] | null;
  road_successors?: ProtoRoadlink[] | null;
  road_sections?: ProtoRoadSection[] | null;
  road_signal?: ProtoSignal[] | null;
  road_objects?: ProtoObject[] | null;
  road_parking_space?: ProtoParkingSpace[] | null;
}

export interface ProtoTopoHeader {
  name?: string | null;
}

export interface ProtoJunctionLaneLink {
  from?: string | null;
  to?: string | null;
}

export interface ProtoJunctionLink {
  connecting_road?: string | null;
  incoming_road?: string | null;
  contact_point?: ProtoEnum;
  junction_lane_link?: ProtoJunctionLaneLink[] | null;
}

export interface ProtoJunctionHeader {
  id?: string | null;
  name?: string | null;
}

export interface ProtoJunctionTopo {
  header?: ProtoJunctionHeader | null;
  junction_links?: ProtoJunctionLink[] | null;
}

export interface ProtoTopoMapFile {
  header?: ProtoTopoHeader | null;
  roads?: ProtoRoadTopo[] | null;
  junctions?: ProtoJunctionTopo[] | null;
}

export interface GeoRoadFile {
  stem: string;
  data: ProtoTileRoadFile;
}

export interface ConvertedRoad {
  road: Road;
  signals: RoadSignal[];
  objects: RoadObjectItem[];
}

export interface SectionAccumulator {
  s: number;
  leftLanes: ProtoLaneTopo[];
  rightLanes: ProtoLaneTopo[];
}
