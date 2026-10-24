// Original, structured-context checks for local evaluation material. These
// checks run in the host; the comparator WASM sees numbers only.
import { decimal } from './decimal.mjs';

export function checkAnswerContext(reference, answer) {
  if (!['FX_NOW', 'MACRO_ECONOMIC_INDICATOR'].includes(reference?.intent)) return { accepted: false, reason: 'unsupported_reference_intent' };
  if (!answer || answer.status !== 'ok') return { accepted: false, reason: 'answer_not_successful' };
  if (answer.intent !== reference.intent) return { accepted: false, reason: 'intent_mismatch' };
  const keys = reference.intent === 'FX_NOW' ? ['base', 'quote', 'unit', 'frequency', 'observation_date'] : ['country', 'indicator_id', 'unit', 'frequency', 'observation_year'];
  for (const key of keys) {
    if (reference[key] === undefined || answer[key] === undefined) return { accepted: false, reason: `missing_${key}` };
    if (String(reference[key]) !== String(answer[key])) return { accepted: false, reason: `${key}_mismatch` };
  }
  try { decimal(answer.numeric_value); } catch { return { accepted: false, reason: 'invalid_numeric_value' }; }
  return { accepted: true, reason: 'context_matches', value: String(answer.numeric_value) };
}

export function scoreStructuredAnswer(reference, answer, { comparator, scale, code, tolerance }) {
  const context = checkAnswerContext(reference, answer);
  if (!context.accepted) return { accepted: false, reason: context.reason, score_bps: null };
  let pointer;
  try {
    const truth = scaleForComparator(reference.numeric_value, scale), miner = scaleForComparator(answer.numeric_value, scale);
    if (truth === 0n) return { accepted: false, reason: 'zero_reference_not_supported_by_comparator', score_bps: null };
    pointer = comparator.imw_alloc(16);
    if (!pointer) throw new Error('Comparator allocation failed');
    const spec = new DataView(comparator.memory.buffer);
    spec.setBigInt64(pointer, BigInt(code), true); spec.setBigInt64(pointer + 8, BigInt(tolerance), true);
    const score = comparator.imw_score_deterministic(truth, miner, pointer);
    if (score < 0n || score > 10000n) return { accepted: false, reason: 'comparator_refused', score_bps: null };
    return { accepted: true, reason: 'context_checked_then_numeric_score', score_bps: Number(score) };
  } catch { return { accepted: false, reason: 'unscalable_or_invalid_comparator_input', score_bps: null }; }
  finally { if (pointer) comparator.imw_free(pointer, 16); }
}

export function scaleForComparator(value, scale) {
  const v = decimal(value), s = decimal(scale);
  if (s.n <= 0n) throw new Error('A positive, explicitly declared scale is required');
  const n = v.n * s.n, d = v.d * s.d, abs = n < 0n ? -n : n;
  const rounded = ((abs * 2n + d) / (2n * d)) * (n < 0n ? -1n : 1n);
  if (rounded < -(2n ** 63n) || rounded >= 2n ** 63n) throw new Error('Comparator i64 scale overflow');
  return rounded;
}
