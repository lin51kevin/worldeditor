/**
 * Web Worker for heavy file parsing (GeoZ protobuf/ZIP, large OpenDRIVE XML).
 *
 * Receives a message with:
 *   { type: 'parse-geoz', buffer: ArrayBuffer, fileName: string }
 *   { type: 'parse-opendrive', xml: string, fileName: string }
 *
 * Responds with:
 *   { type: 'result', data: unknown }  on success
 *   { type: 'error', message: string } on failure
 */

/* eslint-disable no-restricted-globals */

const ctx = self as unknown as Worker;

/** Threshold (bytes) above which we log a warning about transfer size. */
const SIZE_WARN_THRESHOLD = 100 * 1024 * 1024; // 100 MB

ctx.addEventListener('message', async (event: MessageEvent) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'parse-geoz': {
        const { buffer, fileName } = event.data as { buffer: ArrayBuffer; fileName: string };

        if (buffer.byteLength > SIZE_WARN_THRESHOLD) {
          console.warn(`[ParserWorker] Large file: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
        }

        // Dynamic imports so the main bundle stays small
        const [{ default: JSZip }, protobuf] = await Promise.all([
          import('jszip'),
          import('protobufjs/minimal'),
        ]);

        // Import proto definitions (raw strings bundled by Vite)
        const protoModules = import.meta.glob('/src/plugins/io/geoz/proto/*.proto', {
          query: '?raw',
          eager: true,
        });
        const PROTO_SOURCES = Object.entries(protoModules).map(([path, content]) => ({
          filename: path.split('/').pop()!,
          content: content as string,
        }));

        // Build protobuf root
        const root = new protobuf.Root();
        for (const source of PROTO_SOURCES) {
          protobuf.parse(source.content, root, { keepCase: true, alternateCommentMode: true });
        }

        const zip = await JSZip.loadAsync(buffer);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type ZipEntry = any;
        const topoEntries: ZipEntry[] = Object.values(zip.files).filter(
          (e: ZipEntry) => !e.dir && e.name.toLowerCase().endsWith('.topo'),
        );
        const geoEntries: ZipEntry[] = Object.values(zip.files).filter(
          (e: ZipEntry) => !e.dir && e.name.toLowerCase().endsWith('.geo'),
        );

        if (topoEntries.length === 0 && geoEntries.length === 0) {
          ctx.postMessage({
            type: 'result',
            data: {
              name: fileName.replace(/\.[^.]+$/, '') || 'GeoZ Import',
              roads: [],
              junctions: [],
              signals: [],
              objects: [],
            },
          });
          return;
        }

        const topoMapType = root.lookupType('rt.hdmap.TopoMapFile');
        const tileRoadType = root.lookupType('rt.hdmap.TileRoadFile');

        // Helper: decode a zip entry using protobuf
        const decodeEntry = async (entry: ZipEntry, msgType: protobuf.Type) => {
          const buf = await entry.async('arraybuffer');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return msgType.decode(new Uint8Array(buf)) as any;
        };

        const topoFiles = await Promise.all(topoEntries.map((e) => decodeEntry(e, topoMapType)));
        const geoFiles = await Promise.all(
          geoEntries.map(async (e) => ({
            stem: e.name.replace(/\.geo$/i, ''),
            data: await decodeEntry(e, tileRoadType),
          })),
        );

        ctx.postMessage({
          type: 'result',
          data: { protoTopoFiles: topoFiles, protoGeoFiles: geoFiles, fileName },
        });
        return;
      }

      case 'parse-opendrive': {
        const { xml, fileName } = event.data as { xml: string; fileName: string };
        ctx.postMessage({ type: 'result', data: { xml, fileName } });
        return;
      }

      default:
        ctx.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', message });
  }
});