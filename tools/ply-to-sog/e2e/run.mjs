#!/usr/bin/env node
// Loads a SOG / Streamed SOG in headed Chromium (real WebGPU) through the built SDK and reports load time,
// upload status and frame times. Usage:
//   node e2e/run.mjs --mode sog|streamed|lod --path <file under out/, e.g. 71c.../lod-meta.json> --target x,y,z [--shot file.png]
//   lod = view-dependent LOD streaming of a multi-LOD lod-meta.json (ply-to-sog.mjs --format lod); [--lodBudget n]
//   [--progressive 1] draws splats while uploading and reports firstReadyMs
//   node e2e/run.mjs --mode ply --path <absolute .ply>   (baseline through the existing whole-file PLY loader)
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'out');
// SDK_DIR points at another build (e.g. a baseline checkout) for A/B runs.
const SDK = process.env.SDK_DIR ? resolve(process.env.SDK_DIR) : resolve(HERE, '..', '..', '..', 'frontend', 'dist-rnk');
const FRONTEND = resolve(HERE, '..', '..', '..', 'frontend');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.mode || !args.path) {
  console.error('Usage: node e2e/run.mjs --mode sog|streamed|lod --path <relative to out/> [--target x,y,z] [--shot png] [--frames n]');
  process.exit(2);
}

const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webp': 'image/webp', '.html': 'text/html', '.png': 'image/png' };

/** Serve a directory tree; paths are confined to the root. */
function serveFrom(root, rel, res) {
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return false;
  return stat(file)
    .then((s) => {
      if (!s.isFile()) return false;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': s.size, 'access-control-allow-origin': '*' });
      createReadStream(file).pipe(res);
      return true;
    })
    .catch(() => false);
}

const LATENCY_MS = Number(args.latency ?? 0);
const server = createServer(async (req, res) => {
  if (LATENCY_MS > 0) await new Promise((r) => setTimeout(r, LATENCY_MS));
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let served = false;
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(HERE, 'harness.html')));
    return;
  }
  if (path.startsWith('/sdk/')) served = await serveFrom(SDK, path.slice(5), res);
  else if (path.startsWith('/data/')) served = await serveFrom(args.root ? resolve(args.root) : OUT, path.slice(6), res);
  else if (path === '/ply/scene.ply' && args.mode === 'ply') {
    served = await serveFrom(dirname(resolve(args.path)), resolve(args.path).slice(dirname(resolve(args.path)).length + 1), res);
  }
  else served = await serveFrom(SDK, path.slice(1), res); // textures / config requested at the origin root
  if (!served) {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = createRequire(join(FRONTEND, 'package.json'))('playwright-core');
// The frontend's playwright-core may expect a different Chromium build than the one installed locally.
const executablePath =
  process.env.CHROME_PATH ??
  join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1255', 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({
  executablePath,
  headless: false,
  ...(process.env.DEVTOOLS ? { devtools: true } : {}),
  args: ['--enable-unsafe-webgpu', '--disable-gpu-sandbox', ...(process.env.NO_VULKAN ? [] : ['--enable-features=Vulkan']), ...(process.env.NO_VSYNC ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
try {
  // Peak dedicated GPU memory in use (whole system, so run on an otherwise idle GPU).
  let gpuMemMaxMiB = 0;
  let gpuMemTotalMiB = 0;
  const gpuMemBaseMiB = await new Promise((r) => execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], (e, o) => r(e ? 0 : Number(o.trim().split('\n')[0]))));
  const sampler = setInterval(() => {
    execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], (err, out) => {
      if (err) return;
      const [used, total] = out.trim().split('\n')[0].split(',').map(Number);
      gpuMemMaxMiB = Math.max(gpuMemMaxMiB, used);
      gpuMemTotalMiB = total;
    });
  }, 1000);
  const [vw, vh] = (args.viewport ?? '1280x720').split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('console', (m) => {
    if (process.env.VERBOSE || /\[Splat\]|error|warn/i.test(m.text())) console.log('  [page]', m.type(), m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 500)));
  page.on('requestfailed', (r) => console.log('  [requestfailed]', r.url().slice(0, 150), r.failure()?.errorText));
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('  [http', r.status() + ']', r.url().slice(0, 150));
  });
  const dataUrl = args.mode === 'ply' ? `${origin}/ply/scene.ply` : `${origin}/data/${args.path}`;
  const query = new URLSearchParams({ mode: args.mode, url: dataUrl, target: args.target ?? '0,0,0', frames: args.frames ?? '180', ...(args.origin ? { origin: args.origin } : {}), ...(args.cull ? { cull: args.cull } : {}), ...(args.frame ? { frame: args.frame } : {}), ...(args.chase ? { chase: args.chase } : {}), ...(args.occluder ? { occluder: args.occluder } : {}), ...(args.fence ? { fence: args.fence } : {}), ...(args.budget ? { budget: args.budget } : {}), ...(args.hold ? { hold: args.hold } : {}), ...(args.settled ? { settled: args.settled } : {}), ...(args.progressive ? { progressive: args.progressive } : {}), ...(args.lodBudget ? { lodBudget: args.lodBudget } : {}) });
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => !!window.__result, undefined, { timeout: Number(args.timeout ?? 1_800_000) });
  const result = await page.evaluate(() => window.__result);
  clearInterval(sampler);
  result.gpuMemMaxMiB = gpuMemMaxMiB;
  result.gpuMemTotalMiB = gpuMemTotalMiB;
  result.gpuMemBaseMiB = gpuMemBaseMiB;
  if (args.shot) await page.screenshot({ path: resolve(args.shot), timeout: 300_000 });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
