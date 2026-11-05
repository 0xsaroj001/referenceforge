// Original simple baselines, not downloaded adapters. They do not read gold labels
// or import the reference-bound audit implementation.
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function shape(answer) {
  return object(answer) && /^0x[\da-f]{64}$/i.test(answer.tx_hash ?? '') &&
    /^0x[\da-f]{40}$/i.test(answer.from ?? '') && /^0x[\da-f]{40}$/i.test(answer.to ?? '') &&
    ['confirmed', 'reverted', 'pending', 'not_found'].includes(answer.status) &&
    Number.isInteger(answer.block_number) && answer.block_number >= 0 &&
    typeof answer.value_eth === 'number' && Number.isFinite(answer.value_eth) && answer.value_eth >= 0;
}
const status = evidence => evidence?.receipt?.status === '0x1' ? 'confirmed' : evidence?.receipt?.status === '0x0' ? 'reverted' : null;
export const baselines = Object.freeze({
  constant: {
    description: 'Returns the same score for every answer; all comparisons must tie.',
    score: () => 0,
  },
  shape_only: {
    description: 'Checks answer types, basic hash/address shape, status enum and nonnegative numbers. Never consults RPC evidence.',
    score: (_request, _evidence, text) => shape(parse(text)) ? 1 : 0,
  },
  receipt_status_only: {
    description: 'Checks receipt status plus shape. Ignores transaction identity, block consistency, chain and value evidence.',
    score: (_request, evidence, text) => { const answer = parse(text); return shape(answer) && answer.status === status(evidence) ? 1 : 0; },
  },
  naive_fields: {
    description: 'Checks selected transaction fields, receipt status and numeric casts. Ignores RPC chain and matching receipt/block identity; uses lossy Number arithmetic.',
    score: (_request, evidence, text) => {
      const answer = parse(text), tx = evidence?.transaction, receipt = evidence?.receipt;
      if (!shape(answer) || !tx || !receipt) return 0;
      return equal(answer.tx_hash, tx.hash) && equal(answer.from, tx.from) && equal(answer.to, tx.to) &&
        answer.status === status(evidence) && answer.block_number === Number(receipt.blockNumber) &&
        answer.value_eth === Number(tx.value) / 1e18 ? 1 : 0;
    },
  },
});

export const guardBaselines = Object.freeze({
  inclusion_only: {
    description: 'Accepts evidence whenever transaction and receipt have non-null block heights.',
    accept: (_request, evidence) => evidence?.transaction?.blockNumber != null && evidence?.receipt?.blockNumber != null,
  },
  chain_and_status: {
    description: 'Checks expected RPC chain ID and a known receipt success/failure code, ignoring identities, precision and schema gaps.',
    accept: (request, evidence) => {
      const ids = { base: 8453, base_sepolia: 84532 };
      return Object.hasOwn(ids, request?.chain) && Number(evidence?.chain_id) === ids[request.chain] && status(evidence) !== null;
    },
  },
});
