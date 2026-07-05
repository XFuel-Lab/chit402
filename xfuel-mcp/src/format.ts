/**
 * Shared response + error formatting for MCP tools.
 *
 * Every tool returns BOTH a human-readable `text` block and machine-readable
 * `structuredContent` (the raw JSON), so MCP clients can render either.
 */
import { XFuelApiError } from 'xfuel-sdk';

/** Cap response size so a huge payload never blows out the client context. */
export const CHARACTER_LIMIT = 20_000;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** MCP CallToolResult carries an open index signature. */
  [x: string]: unknown;
}

/** Success result: pretty JSON text + structured payload. */
export function ok(structured: Record<string, unknown>, summary?: string): ToolResult {
  let json = JSON.stringify(structured, null, 2);
  if (json.length > CHARACTER_LIMIT) {
    json = json.slice(0, CHARACTER_LIMIT) + '\n… (truncated)';
  }
  const text = summary ? `${summary}\n\n${json}` : json;
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

/** Error result: a clear, actionable message. Never throws. */
export function fail(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/** Turn any thrown value into a concise, actionable message. */
export function describeError(err: unknown): string {
  if (err instanceof XFuelApiError) {
    const base = `XFuel API ${err.status || ''} ${err.code}: ${err.message}`.replace(/\s+/g, ' ').trim();
    const details = err.details?.length ? ` (${err.details.join('; ')})` : '';
    if (err.status === 401) return `${base}${details} — check XFUEL_API_KEY.`;
    if (err.status === 429) return `${base}${details} — rate limited; slow down or use a private API key.`;
    if (err.status === 404) return `${base}${details} — resource not found (check the task_id).`;
    return `${base}${details}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
