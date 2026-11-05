import { createHash } from 'node:crypto';
import { INTENT } from './evidence.mjs';
import { parseUniqueJson } from './strict-json.mjs';

export const normalize = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const chars = value => [...value].length;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const digest = value => createHash('sha256').update(value).digest('hex');
const issue = (errors, line, message) => errors.push({ line, message });
export function provenanceClass(provenance) {
  if (['llm', 'synthetic', 'generated', 'model'].includes(provenance?.source_kind)) return 'unverified';
  try { if (['https:', 'http:'].includes(new URL(provenance?.source_url).protocol)) return 'attested'; } catch {}
  return 'unverified';
}

// A local preflight for documented defaults, not a replacement for node curation.
export function validateJsonl(bytes, intent = INTENT) {
  const errors = [], rows = [], prompts = new Set();
  const data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  if (data.byteLength > 32 * 1024 * 1024) return { valid: false, errors: [{ line: 0, message: 'BODY_TOO_LARGE' }], rows: [] };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { return { valid: false, errors: [{ line: 0, message: 'INVALID_UTF8' }], rows: [] }; }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const n = index + 1;
    if (index === lines.length - 1 && line === '') return;
    if (Buffer.byteLength(line) > 64 * 1024) { issue(errors, n, 'ROW_TOO_LARGE'); return; }
    let row;
    try { row = parseUniqueJson(line); }
    catch (error) { issue(errors, n, error.code === 'DUPLICATE_JSON_KEY' ? error.code : 'INVALID_JSON'); return; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { issue(errors, n, 'INVALID_OBJECT'); return; }
    if (row.intent_id !== undefined && row.intent_id !== intent) issue(errors, n, 'INTENT_MISMATCH');
    const kind = row.label_kind ?? 'preference_pair';
    if (!['preference_pair', 'ground_truth', 'graded_exemplar'].includes(kind)) issue(errors, n, 'UNSUPPORTED_LABEL_KIND');
    if (Object.hasOwn(row, 'source')) issue(errors, n, 'UNEXPECTED_TRUTH_SOURCE');
    for (const [field, min, max] of [['prompt', 16, 16000], ['chosen', 8, 32000], ['rejected', kind === 'preference_pair' ? 8 : 0, 32000]]) {
      const value = row[field];
      if (field === 'rejected' && value === undefined && min === 0) continue;
      if (typeof value !== 'string') { issue(errors, n, 'INVALID_' + field.toUpperCase()); continue; }
      if (controls.test(value)) issue(errors, n, 'CONTROL_CHARS_' + field.toUpperCase());
      const size = chars(normalize(value));
      if (size < min || size > max) issue(errors, n, 'LENGTH_' + field.toUpperCase());
    }
    if (typeof row.prompt === 'string') {
      const key = normalize(row.prompt);
      if (prompts.has(key)) issue(errors, n, 'DUPLICATE_PROMPT');
      prompts.add(key);
    }
    if (typeof row.chosen === 'string' && typeof row.rejected === 'string' && normalize(row.chosen) === normalize(row.rejected)) issue(errors, n, 'IDENTICAL_ANSWERS');
    rows.push(row);
  });
  if (!rows.length) issue(errors, 0, 'NO_ROWS');
  return { valid: errors.length === 0, errors, rows, sha256: digest(data), bytes: data.byteLength,
    provenance: rows.reduce((out, row) => { const type = provenanceClass(row.provenance); out[type] = (out[type] ?? 0) + 1; return out; }, {}) };
}

export function makeRow(item) {
  return { intent_id: INTENT, prompt: item.prompt, chosen: item.chosen, rejected: item.rejected,
    label_kind: 'preference_pair', provenance: { source_kind: 'synthetic',
      source_url: 'https://ethereum.org/developers/docs/apis/json-rpc/' } };
}

// Advisory lexical similarity only. The node's unpublished implementation may differ.
export function maximumPromptSimilarity(rows) {
  const grams = text => { const normalized = normalize(text).toLowerCase(); return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, i) => normalized.slice(i, i + 3))); };
  const sets = rows.map(row => grams(row.prompt));
  let max = 0, pair = null;
  for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) {
    const intersection = [...sets[a]].filter(value => sets[b].has(value)).length;
    const score = intersection / (sets[a].size + sets[b].size - intersection);
    if (score > max) { max = score; pair = [a + 1, b + 1]; }
  }
  return { algorithm: 'character-trigram-jaccard-advisory-only', max_similarity: max, lines: pair };
}
