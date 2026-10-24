import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function minerDescriptor({ id, baseUrl }) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) throw new Error('Supply a positive candidate --id within signed 32-bit range; availability must be checked before registration');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Base URL must be a bare HTTP(S) origin');
  const params = (properties, required) => ({ query: {
    required: properties.filter(([name]) => required.includes(name)).map(([name, description, example]) => ({ name, type: 'string', intents: ['*'], description: `${description}. Example: ${example}` })),
    optional: properties.filter(([name]) => !required.includes(name)).map(([name, description, example]) => ({ name, type: 'string', intents: ['*'], description: `${description}. Example: ${example}` }))
  } });
  return {
    version: '1', kind: 'miner', id, slug: 'referenceforge-numeric', protocol: 'generic', name: 'ReferenceForge Numeric References', base_url: url.origin,
    auth: { type: 'none' },
    description: 'Source-backed numeric references with explicit observation periods and exact decimal strings. FX_NOW serves latest ECB daily reference conversions, not intraday or transaction quotes. MACRO_ECONOMIC_INDICATOR serves published annual World Bank GDP, growth, inflation, unemployment (ILO modelled) and population, not monthly data or forecasts. Unsupported requests fail explicitly.',
    endpoints: [
      { path: '/fx', method: 'GET', description: 'Return one latest published daily reference exchange rate. For example base=USD, quote=INR. The node supplies structured currency fields; the original whole question may also be passed in question. No intraday quotes or historical dates.', intents: ['FX_NOW'], params: params([['base', 'Three-letter base currency', 'USD'], ['quote', 'Three-letter quote currency', 'INR'], ['amount', 'Nonnegative amount to convert; default 1', '1'], ['question', 'Original whole FX question to retain scope constraints', 'Convert 20 USD to INR']], ['base','quote']) },
      { path: '/macro', method: 'GET', description: 'Return one World Bank published annual observation. The node supplies country and indicator; pass the requested year whenever one is stated. Supports ILO-modelled annual unemployment, including US 2019/2010 and Germany 2019. The exact requested year is honored; latest never silently substitutes a missing exact year.', intents: ['MACRO_ECONOMIC_INDICATOR'], params: params([['country', 'ISO two- or three-letter country code', 'US'], ['indicator', 'One of gdp, gdp_growth, inflation, unemployment, population', 'unemployment'], ['year', 'Exact year 1960 through current year when asked, otherwise latest', '2019'], ['question', 'Original whole question to retain unit and frequency constraints', 'United States annual unemployment rate in 2019']], ['country','indicator']) }
    ].map(endpoint => ({ ...endpoint, external_path: endpoint.path })),
    semantics: { signal_mapping: { label_field: 'numeric_value', reason_field: 'summary' }, supported_intents: ['FX_NOW', 'MACRO_ECONOMIC_INDICATOR'] },
    errors: { message_path: 'error.message', code_path: 'error.code' },
    rate_limit_per_sec: 2, cache_ttl_sec: 60, circuit_threshold: 3, circuit_cooldown_seconds: 30
  };
}

if (process.argv[1]?.endsWith('render-miner.mjs')) {
  const args = Object.fromEntries(process.argv.slice(2).map((v, n, a) => v.startsWith('--') ? [v.slice(2), a[n + 1]] : null).filter(Boolean));
  const descriptor = minerDescriptor({ id: Number(args.id), baseUrl: args['base-url'] });
  const text = JSON.stringify(descriptor, null, 2) + '\n'; // JSON is valid YAML 1.2.
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dist/miner.yaml', import.meta.url), text);
  console.log(JSON.stringify({ file: 'dist/miner.yaml', sha256: createHash('sha256').update(text).digest('hex'), status: 'candidate_descriptor_not_registered', id: descriptor.id, base_url: descriptor.base_url }, null, 2));
}
