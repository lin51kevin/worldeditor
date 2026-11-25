#!/usr/bin/env node
// Generates deterministic synthetic 3DGS PLY files and round-trips them through
// splat-transform (PLY -> unbundled SOG -> PLY) to build golden fixtures for the Rust SOG decoder.
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'node_modules', '@playcanvas', 'splat-transform', 'bin', 'cli.mjs');
const OUT = resolve(HERE, '..', '..', 'crates', 'we-core', 'tests', 'fixtures', 'sog');

/** Small deterministic PRNG so fixtures are reproducible. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildPly({ count, restPerChannel, seed }) {
    const rand = mulberry32(seed);
    const uniform = (lo, hi) => lo + (hi - lo) * rand();
    const restCount = restPerChannel * 3;
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
    for (let i = 0; i < restCount; i++) props.push(`f_rest_${i}`);
    props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
    const header =
        `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n` +
        props.map((p) => `property float ${p}`).join('\n') +
        '\nend_header\n';
    const body = new Float32Array(count * props.length);
    for (let i = 0; i < count; i++) {
        const row = [];
        // Mix near and far splats so the log-domain position coding is exercised.
        const spread = i % 10 === 0 ? 400 : 40;
        row.push(uniform(-spread, spread), uniform(-spread, spread), uniform(-spread / 4, spread / 4));
        row.push(uniform(-1.5, 2.5), uniform(-1.5, 2.5), uniform(-1.5, 2.5));
        for (let k = 0; k < restCount; k++) row.push(uniform(-0.3, 0.3));
        row.push(uniform(-4, 4));
        row.push(uniform(-6, -1), uniform(-6, -1), uniform(-6, -1));
        // Random unit quaternion; the sign of w is left random on purpose.
        let q = [uniform(-1, 1), uniform(-1, 1), uniform(-1, 1), uniform(-1, 1)];
        const n = Math.hypot(...q) || 1;
        q = q.map((v) => v / n);
        row.push(...q);
        body.set(row, i * props.length);
    }
    return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body.buffer)]);
}

function run(args) {
    const r = spawnSync(process.execPath, [CLI, '--no-tty', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`splat-transform ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
}

const FIXTURES = [
    { name: 'sh0', count: 1500, restPerChannel: 0, seed: 11 },
    { name: 'sh1', count: 3000, restPerChannel: 3, seed: 22 },
];

await rm(OUT, { recursive: true, force: true });
for (const f of FIXTURES) {
    const dir = join(OUT, f.name);
    await mkdir(dir, { recursive: true });
    const source = join(dir, 'source.ply');
    await writeFile(source, buildPly(f));
    run(['-w', source, join(dir, 'meta.json')]);
    run(['-w', join(dir, 'meta.json'), join(dir, 'roundtrip.ply')]);
    await rm(source);
    process.stdout.write(`fixture ${f.name}: ${f.count} splats\n`);
}
