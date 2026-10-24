import { ServiceError } from './errors.mjs';

// Decimal input never goes through a floating-point arithmetic operation.
export function decimal(input) {
  const text = String(input);
  if (text.length > 96) throw new ServiceError('INVALID_NUMBER', 'Decimal input is too long');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new ServiceError('INVALID_NUMBER', 'Expected a finite decimal number');
  const exponent = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (Math.abs(exponent) > 40) throw new ServiceError('INVALID_NUMBER', 'Decimal scale is outside the supported range');
  const coefficient = BigInt((m[1] === '-' ? '-' : '') + m[2] + (m[3] ?? ''));
  return exponent >= 0 ? { n: coefficient * 10n ** BigInt(exponent), d: 1n } : { n: coefficient, d: 10n ** BigInt(-exponent) };
}

export function formatRatio(n, d, places = 12) {
  if (d === 0n || !Number.isInteger(places) || places < 0 || places > 24) throw new ServiceError('INVALID_NUMBER', 'Invalid denominator or precision');
  const negative = (n < 0n) !== (d < 0n);
  n = n < 0n ? -n : n; d = d < 0n ? -d : d;
  const scale = 10n ** BigInt(places), scaled = (n * scale * 2n + d) / (2n * d);
  const whole = scaled / scale, tail = places ? `.${String(scaled % scale).padStart(places, '0')}` : '';
  return `${negative && scaled !== 0n ? '-' : ''}${whole}${tail}`;
}

export function canonicalDecimal(input) {
  const { n, d } = decimal(input);
  const places = d === 1n ? 0 : d.toString().length - 1;
  return formatRatio(n, d, places).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

export function parseJsonDecimals(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new Error('Node.js with JSON.parse source context is required');
    return context.source;
  });
}
