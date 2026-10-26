import { minerDescriptor } from './render-miner.mjs';
import { onchainDescriptor } from './render-onchain-miner.mjs';
import { UNIFIED_INTENTS } from '../src/unified.mjs';

export const UNIFIED_ORIGIN = 'https://referenceforge.0xsaroj001.workers.dev';
export function unifiedDescriptor({ baseUrl = UNIFIED_ORIGIN } = {}) {
  const numeric = minerDescriptor({ id: 1900999000, baseUrl });
  const onchain = onchainDescriptor({ id: 1900999001, baseUrl });
  return { ...numeric, name: 'ReferenceForge', description: numeric.description + ' ' + onchain.description,
    endpoints: [...numeric.endpoints, ...onchain.endpoints],
    semantics: { signal_mapping: { label_field: 'score_value', reason_field: 'summary' }, supported_intents: [...UNIFIED_INTENTS] },
    rate_limit_per_sec: 1, cache_ttl_sec: 0 };
}
