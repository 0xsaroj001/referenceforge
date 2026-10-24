import { createHash } from 'node:crypto';
import { canonicalDecimal, decimal, formatRatio, parseJsonDecimals } from './decimal.mjs';
import { ServiceError } from './errors.mjs';
import { createSources } from './upstream.mjs';

export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const INDICATORS = Object.freeze({
  gdp: { id: 'NY.GDP.MKTP.CD', name: 'GDP', unit: 'current USD' },
  gdp_growth: { id: 'NY.GDP.MKTP.KD.ZG', name: 'real GDP growth', unit: 'annual percent' },
  inflation: { id: 'FP.CPI.TOTL.ZG', name: 'consumer price inflation', unit: 'annual percent' },
  unemployment: { id: 'SL.UEM.TOTL.ZS', name: 'unemployment (ILO modelled estimate)', unit: 'percent of total labor force' },
  population: { id: 'SP.POP.TOTL', name: 'population', unit: 'persons' }
});
const COUNTRIES = { india: 'IN', 'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB', germany: 'DE', japan: 'JP', china: 'CN', france: 'FR', canada: 'CA', australia: 'AU', brazil: 'BR' };
function inputAlias(p, names, normalize = v => String(v).trim()) {
  const supplied = names.filter(name => p[name] !== undefined && p[name] !== null).map(name => normalize(p[name]));
  if (new Set(supplied).size > 1) throw new ServiceError('CONFLICTING_PARAMETER', `Conflicting aliases for ${names[0]}: ${names.join(', ')}`);
  return supplied[0];
}
const queryText = p => inputAlias(p, ['question', 'query', 'q']) ?? '';

function checkedDate(text) {
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new ServiceError('BAD_SOURCE_DATE', 'Source has an invalid observation date', 503);
  return text;
}

function provenance(source) {
  return { source_url: source.source_url, fetched_at: source.fetched_at, payload_sha256: source.payload_sha256, cache_hit: source.cache_hit };
}

export function parseFxInput(p) {
  const q = queryText(p);
  const baseInput = inputAlias(p, ['base', 'from'], v => String(v).trim().toUpperCase());
  const quoteInput = inputAlias(p, ['quote', 'to'], v => String(v).trim().toUpperCase());
  if (q.length > 4096) throw new ServiceError('INPUT_TOO_LONG', 'Question is limited to 4096 characters');
  if (/\b(?:intraday|tick|bid|ask|tradeable|tradable|executable|real[- ]time|spot)\b/i.test(q)) throw new ServiceError('UNSUPPORTED_FREQUENCY', 'This service provides daily reference rates, not executable or intraday quotes');
  if (p.date || /\b\d{4}-\d{2}-\d{2}\b/.test(q)) throw new ServiceError('UNSUPPORTED_DATE', 'FX currently supports the latest published reference date only');
  const pair = /\b([A-Z]{3})\s*(?:\/|to|in|into|against)\s*([A-Z]{3})\b/i.exec(q);
  const per = /\b([A-Z]{3})\s+per\s+([A-Z]{3})\b/i.exec(q);
  const amountPair = /\b(\d+(?:\.\d+)?)\s+([A-Z]{3})\s+(?:to|in|into)\s+([A-Z]{3})\b/i.exec(q);
  const mentionedPairs = [...q.matchAll(/\b([A-Z]{3})\s*(?:\/|to|in|into|against)\s*([A-Z]{3})\b/gi)].map(m => `${m[1].toUpperCase()}/${m[2].toUpperCase()}`);
  if (!(baseInput && quoteInput) && new Set(mentionedPairs).size > 1) throw new ServiceError('AMBIGUOUS_PAIR', 'One currency pair per request; supply explicit base and quote');
  const base = String(baseInput ?? amountPair?.[2] ?? pair?.[1] ?? per?.[2] ?? '').toUpperCase();
  const quote = String(quoteInput ?? amountPair?.[3] ?? pair?.[2] ?? per?.[1] ?? '').toUpperCase();
  if (p.amount == null && /-\s*\d/.test(q)) throw new ServiceError('INVALID_AMOUNT', 'Negative conversion amounts are not supported');
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) throw new ServiceError('AMBIGUOUS_PAIR', 'Supply explicit three-letter base and quote currencies');
  const amount = canonicalDecimal(p.amount ?? amountPair?.[1] ?? '1');
  const a = decimal(amount);
  if (a.n < 0n || a.n > 1_000_000_000_000n * a.d) throw new ServiceError('INVALID_AMOUNT', 'Amount must be between zero and one trillion');
  return { base, quote, amount };
}

export function parseEcb(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ServiceError('BAD_SOURCE', 'Unexpected XML declarations', 503);
  const dates = [...text.matchAll(/<Cube\b[^>]*\btime=['"]([^'"]+)['"][^>]*>/g)];
  if (dates.length !== 1) throw new ServiceError('BAD_SOURCE', 'Expected one reference-rate observation date', 503);
  const observation_date = checkedDate(dates[0][1]), rates = new Map([['EUR', '1']]);
  for (const m of text.matchAll(/<Cube\b[^>]*currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"][^>]*\/?\s*>/g)) {
    let rate;
    try { rate = decimal(m[2]); } catch { throw new ServiceError('BAD_SOURCE', 'Source contains a malformed reference rate', 503); }
    if (rates.has(m[1]) || rate.n <= 0n) throw new ServiceError('BAD_SOURCE', 'Duplicate or invalid reference rate', 503);
    rates.set(m[1], m[2]);
  }
  if (rates.size < 3) throw new ServiceError('BAD_SOURCE', 'Reference feed did not contain a usable currency set', 503);
  return { observation_date, rates };
}

export function parseMacroInput(p, now = new Date()) {
  const q = queryText(p);
  if (q.length > 4096) throw new ServiceError('INPUT_TOO_LONG', 'Question is limited to 4096 characters');
  if (/\b(?:monthly|quarterly|forecast|predict|projection|current month|this month)\b/i.test(q)) throw new ServiceError('UNSUPPORTED_FREQUENCY', 'Only published annual observations are supported');
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(q)) throw new ServiceError('UNSUPPORTED_FREQUENCY', 'A specific date is not an annual observation period; supply an annual year');
  if (/\b(?:PPP|purchasing power|per capita|constant|seasonally adjusted|CPI index|price index level|index points|policy rate|interest rate)\b/i.test(q) || (/\breal GDP\b/i.test(q) && !/\bgrowth\b/i.test(q))) throw new ServiceError('UNSUPPORTED_UNIT', 'Requested unit or statistic is outside the supported annual indicator definitions');
  const matchedCountries = Object.entries(COUNTRIES).filter(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(q)).map(([, code]) => code);
  const isoAliases = { USA: 'US', IND: 'IN', DEU: 'DE', GBR: 'GB', JPN: 'JP', CHN: 'CN', FRA: 'FR', CAN: 'CA', AUS: 'AU', BRA: 'BR' };
  for (const m of q.matchAll(/\b(US|USA|IN|IND|DE|DEU|GB|GBR|JP|JPN|CN|CHN|FR|FRA|CA|CAN|AU|AUS|BR|BRA)\b/g)) matchedCountries.push(isoAliases[m[1]] ?? m[1]);
  const country = String(p.country ?? (new Set(matchedCountries).size === 1 ? matchedCountries[0] : '')).trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(country)) throw new ServiceError('AMBIGUOUS_COUNTRY', 'Supply one ISO two- or three-letter country code');
  let indicator = p.indicator == null ? undefined : String(p.indicator).trim().toLowerCase();
  if (!indicator) {
    const candidates = [];
    if (/\b(?:inflation|CPI)\b/i.test(q)) candidates.push('inflation');
    if (/\b(?:unemployment|UNEMP)\b/i.test(q)) candidates.push('unemployment');
    if (/\bpopulation\b/i.test(q)) candidates.push('population');
    if (/\bGDP\b/i.test(q)) candidates.push(/\bgrowth\b/i.test(q) ? 'gdp_growth' : 'gdp');
    if (candidates.length === 1) indicator = candidates[0];
  }
  if (!Object.hasOwn(INDICATORS, indicator ?? '')) throw new ServiceError('UNSUPPORTED_INDICATOR', 'Choose gdp, gdp_growth, inflation, unemployment or population');
  const years = [...q.matchAll(/(?<![A-Za-z0-9-])(19\d{2}|20\d{2})(?![A-Za-z0-9-])/g)].map(m => m[1]);
  if (!p.year && new Set(years).size > 1) throw new ServiceError('AMBIGUOUS_YEAR', 'Supply one observation year');
  const year = String(p.year ?? years[0] ?? 'latest');
  if (year !== 'latest' && (!/^\d{4}$/.test(year) || Number(year) < 1960 || Number(year) > now.getUTCFullYear())) throw new ServiceError('INVALID_YEAR', 'Year must be 1960 through the current year, or latest');
  return { country, indicator, year };
}

function validatedFx(text, now) {
  const parsed = parseEcb(text);
  const age = now.getTime() - Date.parse(`${parsed.observation_date}T00:00:00Z`);
  if (age < 0 || age > 7 * 86_400_000) throw new ServiceError('STALE_SOURCE', 'Reference date is in the future or older than seven days', 503);
  return { ...parsed, age };
}

function macroObservation(text, input, now) {
  const definition = INDICATORS[input.indicator]; let data;
  try { data = parseJsonDecimals(text); } catch { throw new ServiceError('BAD_SOURCE', 'World Bank did not return valid numeric JSON', 503); }
  if (!Array.isArray(data) || !data[0] || !Array.isArray(data[1]) || Number(data[0].pages) !== 1) throw new ServiceError('BAD_SOURCE', 'Unexpected or incomplete indicator response', 503);
  const rows = data[1].filter(row => row && row.value !== null && row.value !== undefined && row.indicator?.id === definition.id && (row.country?.id === input.country || row.countryiso3code === input.country) && /^\d{4}$/.test(row.date) && Number(row.date) <= now.getUTCFullYear());
  const candidates = input.year === 'latest' ? rows.filter(row => Number(row.date) >= now.getUTCFullYear() - 6).sort((a, b) => Number(b.date) - Number(a.date)) : rows.filter(row => row.date === input.year);
  if (candidates.length > 1 && candidates[0].date === candidates[1].date) throw new ServiceError('BAD_SOURCE', 'Source returned ambiguous observations for the same country, indicator and year', 503);
  const available = candidates[0];
  if (!available) throw new ServiceError('OBSERVATION_UNAVAILABLE', 'No published observation matches the requested country, indicator and year', 404);
  let value;
  try { value = canonicalDecimal(available.value); } catch { throw new ServiceError('BAD_SOURCE', 'Source observation is not a supported decimal', 503); }
  const updated = checkedDate(data[0].lastupdated);
  if (Date.parse(`${updated}T00:00:00Z`) > now.getTime()) throw new ServiceError('BAD_SOURCE_DATE', 'Source update date is in the future', 503);
  return { available, value, updated };
}

export function createMiner({ sources = createSources(), now = () => new Date() } = {}) {
  return {
    async fx(params) {
      const input = parseFxInput(params), source = await sources.get(ECB_URL, 300_000, { validate: text => validatedFx(text, now()) });
      const { observation_date, rates, age } = validatedFx(source.text, now());
      if (!rates.has(input.base) || !rates.has(input.quote)) throw new ServiceError('UNSUPPORTED_CURRENCY', 'Requested currency is not in the current ECB reference set');
      const b = decimal(rates.get(input.base)), q = decimal(rates.get(input.quote)), a = decimal(input.amount);
      const numerator = q.n * b.d, denominator = q.d * b.n;
      const rate = formatRatio(numerator, denominator), converted_amount = formatRatio(numerator * a.n, denominator * a.d);
      return {
        status: 'ok', mode: 'reference', fallback: false, intent: 'FX_NOW', ...input, rate, converted_amount, unit: `${input.quote} per ${input.base}`, observation_date,
        summary: `1 ${input.base} = ${rate} ${input.quote}; latest published ECB daily reference date ${observation_date}. Reference data for information, not an executable transaction quote.`,
        numeric_value: rate, frequency: 'daily_reference', source: provenance(source), warnings: ['ECB reference rates are published for information; using them for transaction purposes is discouraged.', ...(age > 3 * 86_400_000 ? ['Publication is more than three calendar days old; check the source calendar.'] : [])]
      };
    },
    async macro(params) {
      const input = parseMacroInput(params, now()), definition = INDICATORS[input.indicator];
      const date = input.year === 'latest' ? `${now().getUTCFullYear() - 6}:${now().getUTCFullYear()}` : input.year;
      const url = `https://api.worldbank.org/v2/country/${input.country}/indicator/${definition.id}?format=json&date=${date}&per_page=100`;
      const source = await sources.get(url, 21_600_000, { validate: text => macroObservation(text, input, now()) });
      const { available, value, updated } = macroObservation(source.text, input, now());
      return {
        status: 'ok', mode: 'reference', fallback: false, intent: 'MACRO_ECONOMIC_INDICATOR', ...input, country_name: available.country.value, indicator_id: definition.id,
        value, numeric_value: value, unit: definition.unit, observation_year: Number(available.date), source_last_updated: updated, frequency: 'annual', source: provenance(source),
        summary: `${available.country.value}: ${definition.name} in ${available.date} was ${value} ${definition.unit}, according to the World Bank. Published annual observation, not a live estimate.`,
        warnings: [`Observation period ${available.date} is distinct from retrieval time ${source.fetched_at}.`, 'The latest search window is the current year and preceding six years; no missing requested year is silently substituted.']
      };
    }
  };
}

export function responseDigest(result) {
  // This is our local content digest, not a Telegraph signal hash or receipt.
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
