import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAnswer, deriveOutcome } from './evidence.mjs';
import { baselines, guardBaselines } from './baselines.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateSplit(development, holdout) {
  if (!Array.isArray(development) || !Array.isArray(holdout)) throw new Error('INVALID_SPLIT');
  const devIds = new Set(development.map(x => x.id)), devGroups = new Set(development.map(x => x.failure_group ?? x.scenario));
  const ids = new Set();
  for (const item of holdout) {
    if (!item.id || !item.failure_group || ids.has(item.id)) throw new Error('INVALID_HOLDOUT_ID_OR_GROUP');
    if (devIds.has(item.id) || devGroups.has(item.failure_group)) throw new Error('DEVELOPMENT_HOLDOUT_LEAKAGE');
    ids.add(item.id);
  }
}

// Scorers receive only question/evidence and one answer. Gold labels and the other
// answer are withheld; alternating preferred positions defeats first-answer bias.
export function benchmarkPairs(pairs, scorers) {
  if (!pairs.length) throw new Error('EMPTY_PAIR_BENCHMARK');
  return Object.fromEntries(Object.entries(scorers).map(([name, scorer]) => {
    const cases = pairs.map((item, index) => {
      if (!['left', 'right'].includes(item.preferred) || typeof item.left !== 'string' || typeof item.right !== 'string') throw new Error('INVALID_PAIR_LABEL');
      const input = structuredClone({ request: item.request, evidence: item.evidence });
      const left = scorer.score(input.request, input.evidence, item.left), right = scorer.score(input.request, input.evidence, item.right);
      const leftAgain = scorer.score(input.request, input.evidence, item.left), rightAgain = scorer.score(input.request, input.evidence, item.right);
      if (![left, right, leftAgain, rightAgain].every(Number.isFinite)) throw new Error('NONFINITE_SCORE');
      const margin = item.preferred === 'left' ? left - right : right - left;
      return { id: item.id, failure_group: item.failure_group, preferred: item.preferred, left_score: left, right_score: right,
        result: margin > 0 ? 'correct' : margin < 0 ? 'reversed' : 'tie',
        repeatable: left === leftAgain && right === rightAgain };
    });
    const count = result => cases.filter(x => x.result === result).length;
    return [name, { description: scorer.description, correct: count('correct'), ties: count('tie'), reversed: count('reversed'),
      total: cases.length, strict_ordering_rate: count('correct') / cases.length,
      repeatable: cases.every(x => x.repeatable), cases }];
  }));
}

export function benchmarkGuards(guards, candidates) {
  return Object.fromEntries(Object.entries(candidates).map(([name, candidate]) => {
    const cases = guards.map(item => {
      if (typeof item.expected_accept !== 'boolean') throw new Error('INVALID_GUARD_LABEL');
      const accepted = candidate.accept(structuredClone(item.request), structuredClone(item.evidence));
      if (typeof accepted !== 'boolean') throw new Error('INVALID_GUARD_DECISION');
      return { id: item.id, failure_group: item.failure_group, expected_accept: item.expected_accept, accepted,
        correct: accepted === item.expected_accept };
    });
    return [name, { description: candidate.description, correct: cases.filter(x => x.correct).length,
      unsafe_accepts: cases.filter(x => x.accepted && !x.expected_accept).length,
      unnecessary_refusals: cases.filter(x => !x.accepted && x.expected_accept).length, total: cases.length, cases }];
  }));
}

export async function runFrozenBenchmark({ manifestPath, outDir }) {
  const manifest = JSON.parse(await readFile(manifestPath));
  const corpusBytes = await readFile(resolve(manifest.corpus_path)), devBytes = await readFile(resolve(manifest.development_path));
  if (hash(corpusBytes) !== manifest.corpus_sha256 || hash(devBytes) !== manifest.development_sha256) throw new Error('FROZEN_CORPUS_CHANGED');
  const corpus = JSON.parse(corpusBytes), dev = JSON.parse(devBytes);
  validateSplit([...dev.pairs, ...dev.refusals], [...corpus.pairs, ...corpus.guards]);
  const candidateHash = hash(await readFile(new URL('./evidence.mjs', import.meta.url)));
  const baselineHash = hash(await readFile(new URL('./baselines.mjs', import.meta.url)));
  const scorers = { ...baselines, reference_bound_audit: {
    description: 'Original field/evidence audit, not a trained or network model.', score: (request, evidence, answer) => checkAnswer(request, evidence, answer).valid ? 1 : 0,
  } };
  const pairResults = benchmarkPairs(corpus.pairs, scorers);
  const developmentPairs = dev.pairs.map((item, index) => ({ ...item, failure_group: item.scenario,
    left: index % 2 === 0 ? item.chosen : item.rejected, right: index % 2 === 0 ? item.rejected : item.chosen,
    preferred: index % 2 === 0 ? 'left' : 'right' }));
  const developmentResults = benchmarkPairs(developmentPairs, scorers);
  const guardResults = benchmarkGuards(corpus.guards, { ...guardBaselines, reference_bound_audit: {
    description: 'Original evidence safety/schema refusal policy.', accept: (request, evidence) => { try { deriveOutcome(request, evidence); return true; } catch { return false; } },
  } });
  const report = { version: 1, observed_at: new Date().toISOString(), source_kind: 'synthetic',
    split: 'Separate frozen local failure groups, not platform hidden-pool split or author-blinded evaluation.',
    corpus_sha256: manifest.corpus_sha256, candidate_sha256: candidateHash, baseline_sha256: baselineHash,
    candidate_matches_freeze: candidateHash === manifest.candidate_sha256,
    baselines_match_freeze: baselineHash === manifest.baseline_sha256,
    comparison_phase: candidateHash === manifest.candidate_sha256 && baselineHash === manifest.baseline_sha256 ? 'frozen-source-no-tuning' : 'post-freeze-seen-evaluation',
    pair_count: corpus.pairs.length, guard_count: corpus.guards.length,
    guard_labels: { accepted: corpus.guards.filter(x => x.expected_accept).length, refused: corpus.guards.filter(x => !x.expected_accept).length },
    preferred_positions: { left: corpus.pairs.filter(x => x.preferred === 'left').length, right: corpus.pairs.filter(x => x.preferred === 'right').length },
    pairs: pairResults, guards: guardResults, development_pairs_seen: developmentResults,
    network_model_comparison: false, model_adapter_built: false, independently_observed_transactions: 0,
    limitation: 'Deliberately simple original baselines; synthetic controlled evidence, not proof of neural-model superiority, independent accuracy, unseen human judging or network admission.',
    paid_calls: 0, uploads: 0, transactions: 0 };
  await mkdir(outDir, { recursive: true });
  const stamp = report.observed_at.replace(/[.:]/g, '-');
  const path = resolve(outDir, candidateHash.slice(0, 12) + '-' + baselineHash.slice(0, 8) + '-' + stamp + '-benchmark.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { report, path };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFrozenBenchmark({ manifestPath: resolve(process.argv[2] ?? 'evaluator-v2/local/frozen-holdout-v1.manifest.json'),
    outDir: resolve(process.argv[3] ?? 'reports/evaluator-v2/benchmarks') }).then(({ report, path }) => console.log(JSON.stringify({
      output: path, comparison_phase: report.comparison_phase, pair_count: report.pair_count, guard_count: report.guard_count,
      pairs: Object.fromEntries(Object.entries(report.pairs).map(([key, value]) => [key, { correct: value.correct, ties: value.ties, reversed: value.reversed }])),
      guards: Object.fromEntries(Object.entries(report.guards).map(([key, value]) => [key, { correct: value.correct, unsafe_accepts: value.unsafe_accepts, unnecessary_refusals: value.unnecessary_refusals }])),
    }, null, 2))).catch(error => { console.error('Frozen evaluator benchmark failed:', error.message); process.exitCode = 1; });
}
