/**
 * XFuel Sidecar Import Tool
 *
 * Import usage exports from OpenRouter, Groq, Together, etc. into XFuel book rows.
 * This creates retroactive receipts for spend that happened through other providers.
 *
 * Per whitepaper: imported rows are marked 'imported' scope — not merchant-attested,
 * not payment-verified. They exist for archival and spend tracking, not settlement proof.
 */

import {
  buildSidecarReceipt,
  hashOutput,
  type SidecarReceipt,
} from './receipt.js';

export const IMPORT_RECEIPT_SCOPE = 'imported';

export interface OpenRouterUsageRow {
  id?: string;
  created_at?: string;
  model?: string;
  total_cost?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  origin?: string;
  upstream_id?: string;
  latency_ms?: number;
  generation_id?: string;
  tokens_prompt?: number;
  tokens_completion?: number;
  total_tokens?: number;
  cost?: number;
}

export interface GroqUsageRow {
  request_id?: string;
  created_at?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface GenericUsageRow {
  id?: string;
  created_at?: string;
  model?: string;
  cost?: number;
  total_cost?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  provider?: string;
  hub?: string;
}

export interface ImportConfig {
  /** HMAC signing secret (optional) */
  signingSecret?: string;
  /** XFuel API base URL */
  xfuelBaseUrl?: string;
  /** Default hub if not in the row */
  defaultHub?: string;
}

/**
 * Parse an OpenRouter usage CSV or JSON export.
 * OpenRouter exports as JSON array from the activity dashboard.
 */
export function parseOpenRouterExport(data: string | OpenRouterUsageRow[]): OpenRouterUsageRow[] {
  if (typeof data !== 'string') {
    return data;
  }

  const trimmed = data.trim();

  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as OpenRouterUsageRow[];
  }

  return parseCSV<OpenRouterUsageRow>(trimmed, {
    id: 'string',
    created_at: 'string',
    model: 'string',
    total_cost: 'number',
    prompt_tokens: 'number',
    completion_tokens: 'number',
    tokens_prompt: 'number',
    tokens_completion: 'number',
    cost: 'number',
    origin: 'string',
    upstream_id: 'string',
    latency_ms: 'number',
    generation_id: 'string',
  });
}

/**
 * Parse a Groq usage export (typically JSON from their API).
 */
export function parseGroqExport(data: string | GroqUsageRow[]): GroqUsageRow[] {
  if (typeof data !== 'string') {
    return data;
  }
  return JSON.parse(data.trim()) as GroqUsageRow[];
}

/**
 * Parse a generic usage export with flexible fields.
 */
export function parseGenericExport(data: string | GenericUsageRow[]): GenericUsageRow[] {
  if (typeof data !== 'string') {
    return data;
  }

  const trimmed = data.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  return parseCSV<GenericUsageRow>(trimmed, {
    id: 'string',
    created_at: 'string',
    model: 'string',
    cost: 'number',
    total_cost: 'number',
    prompt_tokens: 'number',
    completion_tokens: 'number',
    total_tokens: 'number',
    provider: 'string',
    hub: 'string',
  });
}

/**
 * Simple CSV parser.
 */
function parseCSV<T>(
  csv: string,
  schema: Record<string, 'string' | 'number'>
): T[] {
  const lines = csv.split('\n').map((l) => l.trim()).filter((l) => l);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/["\s]/g, ''));

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, unknown> = {};

    headers.forEach((header, i) => {
      const value = values[i] || '';
      const type = schema[header];

      if (type === 'number') {
        const num = parseFloat(value);
        row[header] = isNaN(num) ? undefined : num;
      } else {
        row[header] = value || undefined;
      }
    });

    return row as T;
  });
}

/**
 * Parse a single CSV line (handling quoted values).
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Convert OpenRouter rows to XFuel receipts.
 */
export function openRouterToReceipts(
  rows: OpenRouterUsageRow[],
  config: ImportConfig = {}
): SidecarReceipt[] {
  const { signingSecret, xfuelBaseUrl, defaultHub = 'openrouter.ai' } = config;

  return rows.map((row) => {
    const cost = row.total_cost ?? row.cost ?? 0;
    const amount = Math.round(cost * 1_000_000).toString();

    const promptTokens = row.prompt_tokens ?? row.tokens_prompt ?? 0;
    const completionTokens = row.completion_tokens ?? row.tokens_completion ?? 0;

    const receipt = buildSidecarReceipt({
      hub: defaultHub,
      model: row.model || 'unknown',
      amount,
      output: null,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      signingSecret,
      xfuelBaseUrl,
    });

    (receipt as unknown as Record<string, unknown>).imported = {
      source: 'openrouter',
      original_id: row.id || row.generation_id || row.upstream_id,
      original_created_at: row.created_at,
      latency_ms: row.latency_ms,
    };

    return receipt;
  });
}

/**
 * Convert Groq rows to XFuel receipts.
 */
export function groqToReceipts(
  rows: GroqUsageRow[],
  config: ImportConfig = {}
): SidecarReceipt[] {
  const { signingSecret, xfuelBaseUrl, defaultHub = 'api.groq.com' } = config;

  return rows.map((row) => {
    const receipt = buildSidecarReceipt({
      hub: defaultHub,
      model: row.model || 'unknown',
      amount: '0',
      output: null,
      usage: {
        prompt_tokens: row.prompt_tokens ?? 0,
        completion_tokens: row.completion_tokens ?? 0,
        total_tokens: row.total_tokens ?? (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0),
      },
      signingSecret,
      xfuelBaseUrl,
    });

    (receipt as unknown as Record<string, unknown>).imported = {
      source: 'groq',
      original_id: row.request_id,
      original_created_at: row.created_at,
    };

    return receipt;
  });
}

/**
 * Convert generic rows to XFuel receipts.
 */
export function genericToReceipts(
  rows: GenericUsageRow[],
  config: ImportConfig = {}
): SidecarReceipt[] {
  const { signingSecret, xfuelBaseUrl, defaultHub = 'unknown' } = config;

  return rows.map((row) => {
    const cost = row.cost ?? row.total_cost ?? 0;
    const amount = Math.round(cost * 1_000_000).toString();

    const receipt = buildSidecarReceipt({
      hub: row.hub || row.provider || defaultHub,
      model: row.model || 'unknown',
      amount,
      output: null,
      usage: {
        prompt_tokens: row.prompt_tokens ?? undefined,
        completion_tokens: row.completion_tokens ?? undefined,
        total_tokens: row.total_tokens ?? undefined,
      },
      signingSecret,
      xfuelBaseUrl,
    });

    (receipt as unknown as Record<string, unknown>).imported = {
      source: 'generic',
      original_id: row.id,
      original_created_at: row.created_at,
    };

    return receipt;
  });
}

export interface ImportResult {
  imported: number;
  skipped: number;
  receipts: SidecarReceipt[];
  errors: string[];
}

/**
 * Import a usage export file (CSV or JSON) and convert to XFuel receipts.
 * Detects format automatically based on content.
 */
export function importUsageExport(
  data: string,
  config: ImportConfig & { source?: 'openrouter' | 'groq' | 'generic' | 'auto' } = {}
): ImportResult {
  const { source = 'auto', ...restConfig } = config;
  const errors: string[] = [];

  let rows: GenericUsageRow[] = [];
  let detectedSource = source;

  try {
    const trimmed = data.trim();

    if (source === 'auto') {
      if (trimmed.includes('openrouter') || trimmed.includes('generation_id')) {
        detectedSource = 'openrouter';
      } else if (trimmed.includes('groq') || trimmed.includes('request_id')) {
        detectedSource = 'groq';
      } else {
        detectedSource = 'generic';
      }
    }

    if (detectedSource === 'openrouter') {
      const orRows = parseOpenRouterExport(data);
      return {
        imported: orRows.length,
        skipped: 0,
        receipts: openRouterToReceipts(orRows, restConfig),
        errors,
      };
    }

    if (detectedSource === 'groq') {
      const groqRows = parseGroqExport(data);
      return {
        imported: groqRows.length,
        skipped: 0,
        receipts: groqToReceipts(groqRows, restConfig),
        errors,
      };
    }

    rows = parseGenericExport(data);
    return {
      imported: rows.length,
      skipped: 0,
      receipts: genericToReceipts(rows, restConfig),
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      imported: 0,
      skipped: 0,
      receipts: [],
      errors,
    };
  }
}
