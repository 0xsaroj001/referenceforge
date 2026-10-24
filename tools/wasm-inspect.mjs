import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Parse structure only. No module compilation, instantiation or execution.
export function inspectWasm(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '0061736d01000000') throw new Error('Invalid WASM magic/version');
  let cursor = 8;
  const imports = [], exports = [], customSections = [];
  function leb(end = bytes.length) {
    let value = 0, shift = 0;
    for (let n = 0; n < 5; n++) {
      if (cursor >= end) throw new Error('Truncated LEB128');
      const byte = bytes[cursor++]; value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error('Oversized LEB128');
  }
  function string(end) {
    const size = leb(end);
    if (cursor + size > end) throw new Error('Truncated WASM string');
    const value = bytes.subarray(cursor, cursor + size).toString('utf8'); cursor += size; return value;
  }
  while (cursor < bytes.length) {
    const id = bytes[cursor++], size = leb(), end = cursor + size;
    if (end > bytes.length) throw new Error('Truncated WASM section');
    if (id === 0) {
      const name = string(end), data = bytes.subarray(cursor, end);
      customSections.push({ name, bytes: data.length, ...(name === 'telegraph.adapter' ? { metadata: JSON.parse(data.toString('utf8')) } : {}) });
    } else if (id === 2) {
      const count = leb(end);
      // Names of the first import suffice to reject a non-freestanding module.
      if (count) imports.push({ count, module: string(end), name: string(end) });
    } else if (id === 7) {
      const count = leb(end);
      for (let n = 0; n < count; n++) { const name = string(end), kind = bytes[cursor++], index = leb(end); exports.push({ name, kind, index }); }
    }
    cursor = end;
  }
  const names = exports.map(e => e.name);
  return { bytes: bytes.length, imports, exports, customSections,
    comparator: ['imw_score_deterministic', 'imw_alloc', 'imw_free', 'memory'].every(n => names.includes(n)),
    legacyRankAnswer: names.includes('rank_answer'),
    widePackage: names.includes('imwq_embedded') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(inspectWasm(await readFile(process.argv[2])), null, 2));
}
