import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inspectWasm } from './wasm-inspect.mjs';

const root = resolve(import.meta.dirname, '..');
const run = spawnSync('cargo', ['build', '--manifest-path', 'wasm/comparator/Cargo.toml', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C link-arg=--max-memory=2097152 -C link-arg=-zstack-size=65536` }
});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
const raw = await readFile(resolve(root, 'wasm/comparator/target/wasm32-unknown-unknown/release/referenceforge_comparator.wasm'));
function leb(n) { const out = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); }
const name = Buffer.from('telegraph.adapter');
const metadata = { abi_version: 1, class: 'comparator', tool: 'ReferenceForge original comparator 0.2.0' };
const payload = Buffer.concat([leb(name.length), name, Buffer.from(JSON.stringify(metadata))]);
const bytes = Buffer.concat([raw, Buffer.from([0]), leb(payload.length), payload]);
const inspection = inspectWasm(bytes);
if (!inspection.comparator || inspection.imports.length || inspection.legacyRankAnswer) throw new Error('Unexpected module structure');
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/referenceforge-comparator.wasm'), bytes);
const manifest = { artifact: 'referenceforge-comparator.wasm', sha256: createHash('sha256').update(bytes).digest('hex'), metadata, inspection, status: 'local_build_not_registered' };
try { const { keccak_256 } = await import('@noble/hashes/sha3.js'); manifest.keccak256 = `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`; }
catch { manifest.keccak256 = null; manifest.hashNote = 'Install locked development dependencies to compute Ethereum Keccak-256. SHA3-256 is not a substitute.'; }
await writeFile(resolve(root, 'dist/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
