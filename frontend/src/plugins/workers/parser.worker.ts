/**
 * parser.worker.ts
 * Web worker for parsing GeoZ archives into protobuf objects.
 * Minimal, standalone decoder that mirrors the proto parsing logic in io/geoz/parser.ts
 */

import JSZip from 'jszip';
import protobuf from 'protobufjs';
import mainProto from '../io/geoz/proto/Main.proto?raw';
import mapProto from '../io/geoz/proto/map.proto?raw';
import mapGeometryProto from '../io/geoz/proto/map_geometry.proto?raw';
import mapJunctionGeoProto from '../io/geoz/proto/map_junction_geo.proto?raw';
import mapJunctionTopoProto from '../io/geoz/proto/map_junction_topo.proto?raw';
import mapLaneGeoProto from '../io/geoz/proto/map_lane_geo.proto?raw';
import mapLaneTopoProto from '../io/geoz/proto/map_lane_topo.proto?raw';
import mapObjectProto from '../io/geoz/proto/map_object.proto?raw';
import mapRoadGeoProto from '../io/geoz/proto/map_road_geo.proto?raw';
import mapRoadTopoProto from '../io/geoz/proto/map_road_topo.proto?raw';

const PROTO_CONVERSION_OPTIONS: protobuf.IConversionOptions = { defaults: true, enums: String };

const PROTO_SOURCES = [
  { name: 'map_geometry.proto', content: mapGeometryProto },
  { name: 'map_lane_geo.proto', content: mapLaneGeoProto },
  { name: 'map_object.proto', content: mapObjectProto },
  { name: 'map_lane_topo.proto', content: mapLaneTopoProto },
  { name: 'map_junction_geo.proto', content: mapJunctionGeoProto },
  { name: 'map_junction_topo.proto', content: mapJunctionTopoProto },
  { name: 'map_road_geo.proto', content: mapRoadGeoProto },
  { name: 'map_road_topo.proto', content: mapRoadTopoProto },
  { name: 'map.proto', content: mapProto },
  { name: 'Main.proto', content: mainProto },
] as const;

let protoRootPromise: Promise<protobuf.Root> | null = null;

async function buildGeoZProtoRoot(): Promise<protobuf.Root> {
  if (!protoRootPromise) {
    protoRootPromise = Promise.resolve().then(() => {
      const root = new protobuf.Root();
      for (const source of PROTO_SOURCES) {
        protobuf.parse(source.content, root, { keepCase: true, alternateCommentMode: true });
      }
      return root;
    });
  }
  return protoRootPromise;
}

function getZipInput(content: string | ArrayBuffer): string | Uint8Array | ArrayBuffer {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  return content;
}

async function decodeZipEntry<T>(entry: JSZip.JSZipObject, messageType: protobuf.Type): Promise<T> {
  const bytes = await entry.async('uint8array');
  const decoded = messageType.decode(bytes);
  return messageType.toObject(decoded, PROTO_CONVERSION_OPTIONS) as unknown as T;
}

function getFileStem(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  const dotIndex = leaf.lastIndexOf('.');
  return dotIndex > 0 ? leaf.slice(0, dotIndex) : leaf;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (!msg || msg.type !== 'parse-geoz') return;
  const { buffer, fileName } = msg;
  try {
    const zip = await JSZip.loadAsync(getZipInput(buffer));
    const topoEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.topo'));
    const geoEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.geo'));

    if (topoEntries.length === 0 && geoEntries.length === 0) {
      (self as any).postMessage({ type: 'ok', data: { protoTopoFiles: [], protoGeoFiles: [], fileName } });
      return;
    }

    const root = await buildGeoZProtoRoot();
    const topoMapType = root.lookupType('rt.hdmap.TopoMapFile');
    const tileRoadType = root.lookupType('rt.hdmap.TileRoadFile');

    const protoTopoFiles = await Promise.all(topoEntries.map((entry) => decodeZipEntry(entry, topoMapType)));
    const protoGeoFiles = await Promise.all(geoEntries.map(async (entry) => ({ stem: getFileStem(entry.name), data: await decodeZipEntry(entry, tileRoadType) })));

    (self as any).postMessage({ type: 'ok', data: { protoTopoFiles, protoGeoFiles, fileName } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as any).postMessage({ type: 'error', message });
  }
};

export {};
