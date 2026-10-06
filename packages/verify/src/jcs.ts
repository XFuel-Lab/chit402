/**
 * chit402-jcs-v1. Same bytes as `jcsCanonicalize` in the gateway.
 *
 * Every code unit U+0000 through U+001F is `\u00xx`, including tab and newline.
 * That is not RFC 8785, which writes U+0009 as `\t` and U+000A as `\n`.
 * Issuer-history entry hashes and the v11 canonical object use this form.
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
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) pairs.push(`${jcsString(key)}:${jcsValue(value)}`);
  }
  return `{${pairs.join(',')}}`;
}
