import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { auditCase, deriveOutcome, INTENT } from './evidence.mjs';
import { makeRow, validateJsonl, maximumPromptSimilarity } from './pool.mjs';

export async function auditCatalog(catalog) {
  if (!Array.isArray(catalog.pairs) || !Array.isArray(catalog.refusals)) throw new Error('INVALID_CATALOG');
  const ids = new Set();
  for (const item of [...catalog.pairs, ...catalog.refusals]) {
    if (!item.id || ids.has(item.id)) throw new Error('DUPLICATE_CASE_ID');
    ids.add(item.id);
  }
  for (const item of catalog.pairs) auditCase(item);
  for (const item of catalog.refusals) {
    let refusal;
    try { deriveOutcome(item.request, item.evidence); } catch (error) { refusal = error.code; }
    if (refusal !== item.expected_refusal) throw new Error('REFUSAL_MISMATCH:' + item.id);
  }
  const rows = catalog.pairs.map(makeRow);
  const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const preflight = validateJsonl(jsonl);
  if (!preflight.valid) throw new Error('POOL_PREFLIGHT_FAILED:' + JSON.stringify(preflight.errors));
  return { jsonl, report: { artifact_kind: 'original-synthetic-evaluation-material', intent_id: INTENT,
    schema_version: 4, verified_at: new Date().toISOString(), paired_cases: catalog.pairs.length,
    invalid_answers_rejected: catalog.pairs.length, refusal_cases: catalog.refusals.length,
    refusal_reasons: catalog.refusals.map(item => item.expected_refusal),
    scenarios: [...new Set(catalog.pairs.map(item => item.scenario))],
    sha256: preflight.sha256, bytes: preflight.bytes, provenance: preflight.provenance,
    prompt_similarity: maximumPromptSimilarity(rows),
    benchmark_claim: 'Curated fixture and mutation audit only; not independent accuracy, adapter discrimination or network score.',
    node_assigned_testing_ranking_split: 'not locally selectable', admitted: false, submitted: false,
    adapter_built: false, paid_calls: 0, network_calls: 0 } };
}

async function main() {
  const input = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('./local/tx-evidence-cases.json', import.meta.url));
  const out = resolve(process.argv[3] ?? 'reports/evaluator-v2/pool');
  const bytes = await readFile(input);
  const { jsonl, report } = await auditCatalog(JSON.parse(bytes));
  report.catalog_sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'ONCHAIN_TX_LOOKUP_GENERAL.jsonl'), jsonl);
  await writeFile(resolve(out, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, output: out }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error('Evaluator local audit failed:', error.message); process.exitCode = 1;
});
