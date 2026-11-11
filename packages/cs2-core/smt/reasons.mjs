/**
 * Fixed failure reasons. A reason never contains input bytes.
 * An unknown reason is a programmer error and throws.
 */

export const REASONS = Object.freeze([
  'bad_type',
  'bad_length',
  'bad_size',
  'bad_index',
  'bad_key',
  'bad_value',
  'bad_proof',
  'bad_history',
  'bad_epoch',
  'bad_random',
  'bad_padding',
  'bad_depth',
  'bad_kind',
  'rule_1',
  'rule_2',
  'rule_3',
  'rule_4',
  'rule_5',
  'rule_7',
  'key_status_unproven',
]);

const REASON_SET = new Set(REASONS);

export function fail(reason) {
  if (!REASON_SET.has(reason)) throw new Error('unknown reason');
  return { ok: false, reason };
}
