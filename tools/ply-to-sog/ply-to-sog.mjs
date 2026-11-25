#!/usr/bin/env node
// Batch-convert large 3DGS PLY files to SOG with @playcanvas/splat-transform and validate each result.
import { spawn } from 'node:child_process';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'node_modules', '@playcanvas', 'splat-transform', 'bin', 'cli.mjs');

const HELP = `Usage: node ply-to-sog.mjs <input.ply|dir>... [options]

Directories are scanned recursively for *.ply (road_mesh*.ply and files under --min-mb are skipped).

Options:
  --format <sog|unbundled|streamed|lod|auto>
                          sog = one bundled .sog (default; fails on very large scenes because a single
                          WebP image gets too big); unbundled = meta.json + WebP images (what the browser
                          loads as a single SOG); streamed = chunked Streamed SOG, LOD 0 only, full
                          fidelity (lod-meta.json); lod = Streamed SOG with --lod-levels levels, each
                          decimated to --lod-ratio of the previous one (what lodStreaming loads);
                          auto = unbundled up to --streamed-above-m splats, streamed above
  --lod-levels <n>        lod: number of LOD levels including LOD 0 (default: 4)
  --lod-ratio <r>         lod: splat fraction kept per level, 0 < r < 1 (default: 0.3)
  --streamed-above-m <n>  auto: splat count (millions) above which streamed is used (default: 30)
  --beside                Write next to each input as <input dir>/sog/{meta.json|lod-meta.json}
  --lod-chunk-count <k>   Streamed: gaussians per chunk in K (tool default: 512)
  --lod-chunk-extent <m>  Streamed: chunk size in world units (tool default: 16)
  --out <dir>             Output directory (default: ./out)
  --overwrite             Re-convert even if the .sog already exists
  --verify-only           Only verify existing .sog files, never convert
  --gpu <n|cpu>           GPU adapter index for SOG compression (default: auto)
  --sh-color-error <n>    SH palette colour-error target in 8-bit levels (default: tool default)
  --sh-palette-size <n>   Fixed SH palette size (overrides --sh-color-error)
  --sh-iterations <n>     k-means iterations when --sh-palette-size is set
  --filter-harmonics <n>  Drop SH bands above n (lossy, off by default)
  --webp-effort <0-9>     Lossless WebP effort (higher = smaller, slower)
  --max-workers <n>       Encoder worker threads (0 = inline); fewer lowers peak memory
  --verbose               Pass --verbose to splat-transform
  --max-drift <x>         Max mean drift of non-SH, non-rotation columns, as a fraction of stdDev (default: 0.02)
  --max-sh-levels <n>     Max mean drift of f_rest_* columns in 8-bit colour levels (default: 2)
  --render-check          Render PLY and SOG from fixed cameras and compare (PSNR)
  --render-max-m <n>      Above n million splats the render check uses a sphere cut instead (default: 20)
  --render-radius <m>     Radius of that sphere around the scene median (default: 40)
  --views "x,y,z;..."     Camera offsets from the scene median (default: 15,0,15;-15,0,15;15,0,-15)
  --min-psnr <db>         Minimum acceptable PSNR for --render-check (default: 35)
  --min-mb <n>            Directory scan size floor in MB (default: 100)
  --keep-renders          Keep rendered WebP images
  --report <file>         JSON report path (default: <out>/report.json)
`;

function parseArgs(argv) {
    const opts = {
        inputs: [],
        out: join(HERE, 'out'),
        format: 'sog',
        streamedAboveM: 30,
        beside: false,
        lodChunkCount: undefined,
        lodChunkExtent: undefined,
        lodLevels: 4,
        lodRatio: 0.3,
        overwrite: false,
        verifyOnly: false,
        gpu: undefined,
        shColorError: undefined,
        shPaletteSize: undefined,
        shIterations: undefined,
        filterHarmonics: undefined,
        webpEffort: undefined,
        maxWorkers: undefined,
        verbose: false,
        maxDrift: 0.02,
        maxShLevels: 2,
        renderCheck: false,
        renderMaxM: 20,
        renderRadius: 40,
        views: ['15,0,15', '-15,0,15', '15,0,-15'],
        minPsnr: 35,
        minMb: 100,
        keepRenders: false,
        report: undefined,
    };
    const takes = new Set([
        '--out', '--format', '--lod-chunk-count', '--lod-chunk-extent', '--gpu', '--sh-color-error', '--sh-palette-size', '--sh-iterations',
        '--filter-harmonics', '--webp-effort', '--max-workers', '--max-drift', '--max-sh-levels', '--render-max-m', '--render-radius', '--views',
        '--min-psnr', '--min-mb', '--report', '--streamed-above-m', '--lod-levels', '--lod-ratio',
    ]);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') {
            process.stdout.write(HELP);
            process.exit(0);
        }
        if (!a.startsWith('--')) {
            opts.inputs.push(resolve(a));
            continue;
        }
        if (takes.has(a)) {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${a} needs a value`);
            switch (a) {
                case '--out': opts.out = resolve(v); break;
                case '--format':
                    if (!['sog', 'unbundled', 'streamed', 'lod', 'auto'].includes(v)) {
                        throw new Error('--format must be sog, unbundled, streamed, lod or auto');
                    }
                    opts.format = v;
                    break;
                case '--lod-levels':
                    opts.lodLevels = Number(v);
                    if (!Number.isInteger(opts.lodLevels) || opts.lodLevels < 2) throw new Error('--lod-levels must be an integer >= 2');
                    break;
                case '--lod-ratio':
                    opts.lodRatio = Number(v);
                    if (!(opts.lodRatio > 0 && opts.lodRatio < 1)) throw new Error('--lod-ratio must be between 0 and 1');
                    break;
                case '--streamed-above-m': opts.streamedAboveM = Number(v); break;
                case '--lod-chunk-count': opts.lodChunkCount = v; break;
                case '--lod-chunk-extent': opts.lodChunkExtent = v; break;
                case '--gpu': opts.gpu = v; break;
                case '--sh-color-error': opts.shColorError = v; break;
                case '--sh-palette-size': opts.shPaletteSize = v; break;
                case '--sh-iterations': opts.shIterations = v; break;
                case '--filter-harmonics': opts.filterHarmonics = v; break;
                case '--webp-effort': opts.webpEffort = v; break;
                case '--max-workers': opts.maxWorkers = v; break;
                case '--max-drift': opts.maxDrift = Number(v); break;
                case '--max-sh-levels': opts.maxShLevels = Number(v); break;
                case '--render-max-m': opts.renderMaxM = Number(v); break;
                case '--render-radius': opts.renderRadius = Number(v); break;
                case '--views': opts.views = v.split(';').map((s) => s.trim()).filter(Boolean); break;
                case '--min-psnr': opts.minPsnr = Number(v); break;
                case '--min-mb': opts.minMb = Number(v); break;
                case '--report': opts.report = resolve(v); break;
            }
            continue;
        }
        switch (a) {
            case '--overwrite': opts.overwrite = true; break;
            case '--beside': opts.beside = true; break;
            case '--verify-only': opts.verifyOnly = true; break;
            case '--render-check': opts.renderCheck = true; break;
            case '--keep-renders': opts.keepRenders = true; break;
            case '--verbose': opts.verbose = true; break;
            default: throw new Error(`Unknown option ${a}\n\n${HELP}`);
        }
    }
    if (opts.inputs.length === 0) throw new Error(`No input given\n\n${HELP}`);
    opts.report ??= join(opts.out, 'report.json');
    return opts;
}

/** Run splat-transform and resolve with its combined output. */
function runCli(args, { echo = false } = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, [CLI, '--no-tty', ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let text = '';
        const onData = (chunk) => {
            text += chunk;
            if (echo) process.stdout.write(chunk);
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolvePromise(text);
            else reject(new Error(`splat-transform exited with ${code}\n${text.split('\n').slice(-15).join('\n')}`));
        });
    });
}

function extractJson(text) {
    const start = text.indexOf('{\n');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error(`No JSON in output:\n${text.slice(-500)}`);
    return JSON.parse(text.slice(start, end + 1));
}

/** Streamed SOG indexes hold several LODs; always read LOD 0 so counts and stats match the source PLY. */
const source = (file, actions = []) => (basename(file) === 'lod-meta.json' ? [file, '-L', '0', ...actions] : [file, ...actions]);

const info = async (file) => extractJson(await runCli([...source(file), '--info', 'json', 'null']));
const stats = async (file) => extractJson(await runCli([...source(file), '--stats', 'json', 'null']));

async function sizeOf(path) {
    const s = await stat(path);
    if (!s.isDirectory()) return s.size;
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
        total += await sizeOf(join(path, entry.name));
    }
    return total;
}

async function scan(path, minBytes) {
    const s = await stat(path);
    if (s.isFile()) return [path];
    const found = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) {
            found.push(...(await scan(full, minBytes)));
        } else if (
            extname(entry.name).toLowerCase() === '.ply' &&
            !entry.name.toLowerCase().startsWith('road_mesh') &&
            (await stat(full)).size >= minBytes
        ) {
            found.push(full);
        }
    }
    return found;
}

function outputStem(input) {
    const dir = dirname(input);
    return basename(dir) === 'point_cloud' ? basename(dirname(dir)) : basename(input, extname(input));
}

function convertArgs(opts, format, input, output, extraLods = []) {
    const args = ['-w'];
    if (opts.gpu !== undefined) args.push('-g', opts.gpu);
    if (opts.webpEffort !== undefined) args.push('--webp-effort', opts.webpEffort);
    if (opts.maxWorkers !== undefined) args.push('--max-workers', opts.maxWorkers);
    if (opts.verbose) args.push('--verbose');
    if (opts.shPaletteSize !== undefined) args.push('--sh-palette-size', opts.shPaletteSize);
    else if (opts.shColorError !== undefined) args.push('--sh-color-error', opts.shColorError);
    if (opts.shIterations !== undefined) args.push('-i', opts.shIterations);
    if (opts.lodChunkCount !== undefined) args.push('--lod-chunk-count', opts.lodChunkCount);
    if (opts.lodChunkExtent !== undefined) args.push('--lod-chunk-extent', opts.lodChunkExtent);
    args.push('--memory', input);
    if (format === 'streamed' || format === 'lod') args.push('-l', '0');
    // Coarser levels are separate PLY files, tagged with their level.
    extraLods.forEach((file, i) => args.push(file, '-l', String(i + 1)));
    args.push('--filter-nan');
    if (opts.filterHarmonics !== undefined) args.push('-H', opts.filterHarmonics);
    args.push(output);
    return args;
}

/**
 * Write LOD levels 1..n-1 next to `output` as PLY files, each decimated from the previous level, so the
 * final Streamed SOG can tag them. Returns the files in level order.
 */
async function writeLodLevels(opts, input, dir) {
    const files = [];
    let previous = input;
    for (let level = 1; level < opts.lodLevels; level++) {
        const file = join(dir, `lod${level}.ply`);
        await runCli(['-w', ...(opts.gpu !== undefined ? ['-g', opts.gpu] : []), previous, '--filter-nan', '--decimate', `${opts.lodRatio * 100}%`, file]);
        files.push(file);
        previous = file;
    }
    return files;
}

/** Largest SH-band-1 basis magnitude, converting an SH coefficient error into colour levels. */
const SH_BASIS_MAX = 0.4886;

/**
 * Worst per-column mean/median drift. Core columns are relative to the column stdDev; SH-rest columns are
 * reported in 8-bit colour levels. rot_* is skipped: SOG stores q and -q as the same rotation (w >= 0), so
 * the marginal stats of those columns legitimately differ; the render check covers rotations instead.
 */
function compareStats(a, b) {
    const sa = a.stats[0];
    const sb = b.stats[0];
    const worst = { core: { column: '', drift: 0 }, sh: { column: '', drift: 0 } };
    sa.columns.forEach((column, i) => {
        const j = sb.columns.indexOf(column);
        if (j < 0 || column.startsWith('rot_')) return;
        // Mean only: splat-transform's median is a histogram estimate, off by metres on scenes with +-5 km outliers.
        const delta = Math.abs(sa.data.mean[i] - sb.data.mean[j]);
        const isSh = column.startsWith('f_rest_');
        const drift = isSh ? delta * 255 * SH_BASIS_MAX : delta / Math.max(sa.data.stdDev[i], 1e-9);
        const group = isSh ? worst.sh : worst.core;
        if (drift > group.drift) {
            group.column = column;
            group.drift = drift;
        }
    });
    return worst;
}

async function psnrOf(fileA, fileB) {
    const { default: sharp } = await import('sharp');
    const load = async (f) => sharp(await readFile(f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [a, b] = await Promise.all([load(fileA), load(fileB)]);
    if (a.data.length !== b.data.length) throw new Error('Rendered images differ in size');
    let sq = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < a.data.length; i++) {
        const d = a.data[i] - b.data[i];
        sq += d * d;
        sum += a.data[i];
        sumSq += a.data[i] * a.data[i];
    }
    const n = a.data.length;
    const mse = sq / n;
    const variance = sumSq / n - (sum / n) ** 2;
    return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), flat: variance < 4 };
}

/**
 * Position of a real splat near the middle of the scene: of ~1000 evenly sampled splats, the one closest to
 * their per-axis median. Marginal medians alone can land in empty space, which breaks the sphere cut.
 */
async function sampleCenter(plyPath, count) {
    const handle = await open(plyPath, 'r');
    try {
        const head = Buffer.alloc(16384);
        await handle.read(head, 0, head.length, 0);
        const text = head.toString('latin1');
        const marker = 'end_header\n';
        const end = text.indexOf(marker) + marker.length;
        const props = [...text.slice(0, end).matchAll(/^property float (\w+)$/gm)].map((m) => m[1]);
        const stride = props.length * 4;
        const [ix, iy, iz] = ['x', 'y', 'z'].map((p) => props.indexOf(p));
        if (end < marker.length || stride === 0 || ix < 0 || iy < 0 || iz < 0) {
            throw new Error('unsupported PLY layout for sampling');
        }
        const samples = [];
        const row = Buffer.alloc(stride);
        const step = Math.max(1, Math.floor(count / 1000));
        for (let i = 0; i < count; i += step) {
            await handle.read(row, 0, stride, end + i * stride);
            samples.push([row.readFloatLE(ix * 4), row.readFloatLE(iy * 4), row.readFloatLE(iz * 4)]);
        }
        const median = [0, 1, 2].map((k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1]);
        const dist = (s) => Math.hypot(s[0] - median[0], s[1] - median[1], s[2] - median[2]);
        const best = samples.reduce((a, b) => (dist(b) < dist(a) ? b : a));
        return best.map((v) => Number(v.toFixed(3)));
    } finally {
        await handle.close();
    }
}

async function renderCheck(opts, input, output, median, stem, sphere) {
    const [tx, ty, tz] = median;
    // Scenes too big for the renderer's GPU residency are cut to a sphere around the views (same cut on both sides).
    const actions = sphere ? ['-S', `${median.join(',')},${opts.renderRadius}`] : [];
    const results = [];
    for (const [index, view] of opts.views.entries()) {
        const [dx, dy, dz] = view.split(',').map(Number);
        const cam = [tx + dx, ty + dy, tz + dz].join(',');
        const camArgs = ['--camera-pos', cam, '--camera-target', median.join(','), '--resolution', '1280x720'];
        const a = join(opts.out, `${stem}.ply.${index}.webp`);
        const b = join(opts.out, `${stem}.sog.${index}.webp`);
        await runCli(['-w', ...source(input, actions), a, ...camArgs]);
        await runCli(['-w', ...source(output, actions), b, ...camArgs]);
        results.push({ view, ...(await psnrOf(a, b)) });
        if (!opts.keepRenders) await Promise.all([rm(a, { force: true }), rm(b, { force: true })]);
    }
    return results;
}

/** Resolve `auto` from the splat count: a single WebP image per attribute fails on very large scenes. */
function resolveFormat(opts, splatCount) {
    if (opts.format !== 'auto') return opts.format;
    return splatCount > opts.streamedAboveM * 1e6 ? 'streamed' : 'unbundled';
}

function outputPath(opts, format, input, stem) {
    const dir = opts.beside ? join(dirname(input), 'sog') : join(opts.out, stem);
    if (format === 'streamed' || format === 'lod') return join(dir, 'lod-meta.json');
    if (format === 'unbundled') return join(dir, 'meta.json');
    return opts.beside ? join(dir, `${stem}.sog`) : join(opts.out, `${stem}.sog`);
}

async function processOne(opts, input) {
    const stem = outputStem(input);
    const row = { input, checks: [], ok: true };
    const fail = (msg) => {
        row.ok = false;
        row.checks.push(`FAIL ${msg}`);
    };
    const note = (msg) => row.checks.push(`ok   ${msg}`);

    const inSize = (await stat(input)).size;
    const inInfo = await info(input);
    const format = resolveFormat(opts, inInfo.numGaussians);
    const output = outputPath(opts, format, input, stem);
    row.format = format;
    row.output = output;
    row.inputBytes = inSize;
    row.count = inInfo.numGaussians;
    row.shBands = inInfo.shBands;

    let exists = false;
    try {
        await stat(output);
        exists = true;
    } catch { /* not converted yet */ }

    if (!opts.verifyOnly && (opts.overwrite || !exists)) {
        const t0 = Date.now();
        await mkdir(dirname(output), { recursive: true });
        let levelDir = null;
        let levelFiles = [];
        try {
            if (format === 'lod') {
                levelDir = join(opts.out, `.lod-${stem}`);
                await mkdir(levelDir, { recursive: true });
                levelFiles = await writeLodLevels(opts, input, levelDir);
            }
            const log = await runCli(convertArgs(opts, format, input, output, levelFiles));
            row.peak = /\[(peak[^\]]*)\]/.exec(log)?.[1];
        } finally {
            if (levelDir) await rm(levelDir, { recursive: true, force: true });
        }
        row.convertSeconds = Math.round((Date.now() - t0) / 100) / 10;
    } else if (!exists) {
        throw new Error(`${output} does not exist (--verify-only)`);
    }

    const outSize = await sizeOf(format === 'sog' ? output : dirname(output));
    row.outputBytes = outSize;
    row.ratio = Math.round((inSize / outSize) * 10) / 10;

    const outInfo = await info(output);
    const expectedBands = opts.filterHarmonics !== undefined ? Math.min(inInfo.shBands, Number(opts.filterHarmonics)) : inInfo.shBands;
    if (outInfo.numGaussians !== inInfo.numGaussians) {
        fail(`count ${inInfo.numGaussians} -> ${outInfo.numGaussians}`);
    } else {
        note(`count ${inInfo.numGaussians.toLocaleString()} preserved`);
    }
    if (outInfo.shBands !== expectedBands) fail(`SH bands ${inInfo.shBands} -> ${outInfo.shBands}`);
    else note(`SH bands ${outInfo.shBands}`);
    if (outInfo.model !== inInfo.model) fail(`model ${inInfo.model} -> ${outInfo.model}`);

    if (format === 'lod') {
        const lodMeta = JSON.parse(await readFile(output, 'utf8'));
        if (lodMeta.lodLevels !== opts.lodLevels) fail(`LOD levels ${opts.lodLevels} -> ${lodMeta.lodLevels}`);
        else note(`${lodMeta.lodLevels} LOD levels${lodMeta.counts ? ` (${lodMeta.counts.map((c) => c.toLocaleString()).join(' / ')} splats)` : ''}`);
        row.lodCounts = lodMeta.counts;
    }

    const [sIn, sOut] = await Promise.all([stats(input), stats(output)]);
    const worst = compareStats(sIn, sOut);
    row.worstDrift = worst;
    for (const [group, limit, unit] of [['core', opts.maxDrift, ' (x stdDev)'], ['sh', opts.maxShLevels, ' colour levels']]) {
        const w = worst[group];
        if (!w.column) continue;
        if (w.drift > limit) fail(`${group} drift ${w.drift.toFixed(4)}${unit} on ${w.column} > ${limit}`);
        else note(`${group} drift ${w.drift.toFixed(5)}${unit} (${w.column}) <= ${limit}`);
    }

    if (opts.renderCheck) {
        const big = inInfo.numGaussians / 1e6 > opts.renderMaxM;
        {
            const ix = sIn.stats[0].columns.indexOf('x');
            const statsMedian = [0, 1, 2].map((k) => Number(sIn.stats[0].data.median[ix + k].toFixed(3)));
            const median = big ? await sampleCenter(input, inInfo.numGaussians) : statsMedian;
            const renders = await renderCheck(opts, input, output, median, stem, big);
            row.renders = renders.map((r) => ({ ...r, psnr: Math.round(r.psnr * 100) / 100 }));
            const worstPsnr = Math.min(...renders.map((r) => r.psnr));
            const scope = big ? ` (${opts.renderRadius} m sphere)` : '';
            if (renders.every((r) => r.flat)) fail(`render views are blank${scope}; adjust --views`);
            else if (worstPsnr < opts.minPsnr) fail(`PSNR ${worstPsnr.toFixed(2)} dB < ${opts.minPsnr}${scope}`);
            else note(`PSNR min ${worstPsnr.toFixed(2)} dB over ${renders.length} views${scope}`);
        }
    }
    return row;
}

const gb = (n) => `${(n / 1073741824).toFixed(2)} GB`;

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    await mkdir(opts.out, { recursive: true });
    const files = [];
    for (const input of opts.inputs) files.push(...(await scan(input, opts.minMb * 1048576)));
    if (files.length === 0) throw new Error('No PLY files found');

    const rows = [];
    for (const file of files) {
        process.stdout.write(`\n== ${file}\n`);
        try {
            const row = await processOne(opts, file);
            rows.push(row);
            process.stdout.write(
                `   ${gb(row.inputBytes)} -> ${gb(row.outputBytes)} (x${row.ratio})` +
                `${row.convertSeconds ? `, ${row.convertSeconds}s` : ''}${row.peak ? `, ${row.peak}` : ''}\n`,
            );
            for (const c of row.checks) process.stdout.write(`   ${c}\n`);
        } catch (err) {
            rows.push({ input: file, ok: false, checks: [`FAIL ${err.message}`] });
            process.stdout.write(`   FAIL ${err.message}\n`);
        }
    }
    await writeFile(opts.report, JSON.stringify(rows, null, 2));
    const failed = rows.filter((r) => !r.ok).length;
    process.stdout.write(`\n${rows.length - failed}/${rows.length} passed. Report: ${opts.report}\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
});
