/**
 * chit402-jcs-v1. Same bytes as `jcsCanonicalize` in the gateway.
 *
 * Every code unit U+0000 through U+001F is `\u00xx`, including tab and newline.
 * Payload versions through v10, `entry_hash`, and the well-known issuer-history
 * document use this form. Payload v11 uses {@link rfc8785Canonicalize}.
 */

export function jcsCanonicalize(value: unknown): string {
  return jcsValue(value);
}

function jcsValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return String(value);
  }
  if (type === 'string') return jcsString(value as string);
  if (Array.isArray(value)) return `[${value.map(jcsValue).join(',')}]`;
  if (type === 'object') return jcsObject(value as Record<string, unknown>);
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

function jcsString(str: string): string {
  let result = '"';
  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const code = str.charCodeAt(i);
    if (code < 32) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (char === '"') {
      result += '\\"';
    } else if (char === '\\') {
      result += '\\\\';
    } else {
      result += char;
    }
  }
  return `${result}"`;
}

function jcsObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort(utf16Compare);
  const pairs: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) pairs.push(`${jcsString(key)}:${jcsValue(value)}`);
  }
  return `{${pairs.join(',')}}`;
}

function utf16Compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * RFC 8785. String escaping and number serialization follow
 * `JSON.stringify`. Object keys are sorted by UTF-16 code unit.
 * Lone surrogates and non-finite numbers are rejected.
 * Payload v11, refusal v2, and `snapshot_hash` use this form.
 */
export function rfc8785Canonicalize(value: unknown): string {
  return rfc8785Value(value);
}

function assertWellFormedUtf16(str: string): void {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new Error('Cannot canonicalize a lone surrogate');
      }
      i += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new Error('Cannot canonicalize a lone surrogate');
    }
  }
}

function rfc8785String(str: string): string {
  assertWellFormedUtf16(str);
  return JSON.stringify(str);
}

function rfc8785Value(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (type === 'string') return rfc8785String(value as string);
  if (Array.isArray(value)) return `[${value.map(rfc8785Value).join(',')}]`;
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(utf16Compare);
    const pairs: string[] = [];
    for (const key of keys) {
      const child = obj[key];
      if (child !== undefined) pairs.push(`${rfc8785String(key)}:${rfc8785Value(child)}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}
