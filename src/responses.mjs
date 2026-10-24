import { ServiceError } from './errors.mjs';

export function serviceHealth() {
  return { status: 'ok', service: 'ReferenceForge', version: '0.2.1', registration_status: 'not_registered', supported_intents: ['FX_NOW', 'MACRO_ECONOMIC_INDICATOR'], endpoints: ['/fx', '/macro'], payment_flow_verified: false };
}

// These are our HTTP response modes, not Telegraph receipts or scoring codes.
export function failureResponse(error) {
  const known = error instanceof ServiceError;
  const status = known ? error.status : 500;
  return {
    status,
    body: {
      status: 'error', mode: status >= 500 ? 'unavailable' : 'refusal', fallback: false,
      error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Unexpected service error' },
      verified_answer: false
    }
  };
}
