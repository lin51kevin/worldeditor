#!/usr/bin/env node
// Loads a scene in the hosted SuperSplat Editor (headed Chromium, real WebGPU) and reports load time, peak GPU memory
// and orbit frame times, for comparison with e2e/run.mjs. Usage:
//   node e2e/supersplat.mjs --file <absolute path to .ply|.sog|meta.json> [--wait ms] [--shot png]
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..', '..', '..', 'frontend');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.file) {
  console.error('Usage: node e2e/supersplat.mjs --file <path> [--wait ms] [--shot png]');
  process.exit(2);
}

const file = resolve(args.file);
const root = dirname(file);
const TYPES = { '.json': 'application/json', '.webp': 'image/webp', '.ply': 'application/octet-stream', '.sog': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
  const full = normalize(join(root, rel));
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-private-network': 'true' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'access-control-allow-headers': '*' });
    res.end();
    return;
  }
  try {
    const s = await stat(full);
    if (!full.startsWith(root) || !s.isFile()) throw new Error('nf');
    res.writeHead(200, { ...headers, 'content-type': TYPES[extname(full)] ?? 'application/octet-stream', 'content-length': s.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404, headers);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/${basename(file)}`;

const { chromium } = createRequire(join(FRONTEND, 'package.json'))('playwright-core');
const executablePath =
  process.env.CHROME_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1255', 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: ['--enable-unsafe-webgpu', '--disable-gpu-sandbox', '--enable-features=Vulkan', '--disable-features=PrivateNetworkAccessChecks', ...(process.env.NO_VSYNC ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
try {
  let gpuMemMaxMiB = 0;
  let gpuMemBaseMiB = 0;
  const sample = () =>
    new Promise((resolveSample) =>
      execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], (err, out) =>
        resolveSample(err ? 0 : Number(out.trim().split('\n')[0])),
      ),
    );
  gpuMemBaseMiB = await sample();
  const timeline = [];
  const sampler = setInterval(async () => {
    const mem = await sample();
    gpuMemMaxMiB = Math.max(gpuMemMaxMiB, mem);
    timeline.push({ t: Date.now(), mem });
  }, 500);

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const requests = [];
  page.on('response', (r) => {
    if (r.url().startsWith('http://127.0.0.1')) requests.push({ url: r.url().slice(-40), status: r.status(), t: Date.now() });
  });
  page.on('console', (m) => {
    if (process.env.VERBOSE) console.log('  [page]', m.type(), m.text().slice(0, 200));
  });
  const t0 = Date.now();
  let readyAt = 0;
  page.on('console', (m) => {
    if (!readyAt && /SuperSplat v/.test(m.text())) readyAt = Date.now();
  });
  await page.goto(`https://superspl.at/editor?load=${encodeURIComponent(url)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // The status bar shows the splat count once the scene is resident (text lives in shadow DOM; locators pierce it).
  let loadedAt = 0;
  try {
    await page.getByText(/\d{1,3}(,\d{3}){2,}/).first().waitFor({ timeout: Number(args.wait ?? 120_000) });
    loadedAt = Date.now();
  } catch { /* never appeared */ }
  const firstByteMs = readyAt ? readyAt - t0 : null;
  await page.waitForTimeout(3000);
  const loadedMs = loadedAt ? loadedAt - (readyAt || t0) : null;
  const fetched = null;

  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'left' });
  const frames = await page.evaluate(
    () =>
      new Promise((resolveFrames) => {
        const deltas = [];
        let last = performance.now();
        const end = last + 4000;
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else resolveFrames(deltas);
        };
        requestAnimationFrame(tick);
      }),
  );
  // Drag while the frame sampler above runs (orbit motion keeps the editor re-rendering).
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(640 + i * 6, 360 + (i % 5) * 2);
    await page.waitForTimeout(60);
  }
  await page.mouse.up({ button: 'left' });
  clearInterval(sampler);
  frames.sort((a, b) => a - b);
  const pick = (q) => Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] * 10) / 10;
  if (args.shot) await page.screenshot({ path: resolve(args.shot), timeout: 120_000 });
  console.log(
    JSON.stringify(
      {
        url,
        editorReadyMs: firstByteMs,
        gpuMem90PctAfterReadyMs: (() => {
          const hit = timeline.find((p) => p.mem >= gpuMemBaseMiB + 0.9 * (gpuMemMaxMiB - gpuMemBaseMiB));
          return hit ? hit.t - (readyAt || t0) : null;
        })(),
        sceneLoadMs: loadedMs,
        requestCount: requests.length,
        gpuMemBaseMiB,
        gpuMemMaxMiB,
        gpuMemDeltaMiB: gpuMemMaxMiB - gpuMemBaseMiB,
        orbitFrameMs: { p50: pick(0.5), p95: pick(0.95), max: pick(1), samples: frames.length },
        fetchedStatus: fetched,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
