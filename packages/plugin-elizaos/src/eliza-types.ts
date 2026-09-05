/** Minimal ElizaOS surface used by this plugin (avoids broken upstream .d.ts re-exports). */

export interface Character {
  system?: string;
  settings?: Record<string, unknown>;
}

export interface LoggerLike {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  success?: (message: string) => void;
}

export interface IAgentRuntime {
  character: Character;
  logger?: LoggerLike;
  getSetting(key: string): string | boolean | number | null;
}

export interface Memory {
  [key: string]: unknown;
}

export interface State {
  [key: string]: unknown;
}

export interface ProviderResult {
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface Provider {
  name: string;
  description?: string;
  get: (runtime: IAgentRuntime, message: Memory, state: State) => Promise<ProviderResult>;
}

export interface GenerateTextParams {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface Plugin {
  name: string;
  description: string;
  priority?: number;
  config?: Record<string, string | undefined>;
  init?: (config: Record<string, string>, runtime: IAgentRuntime) => Promise<void>;
  providers?: Provider[];
  models?: Record<
    string,
    (runtime: IAgentRuntime, params: GenerateTextParams) => Promise<string>
  >;
}

export const ModelType = {
  TEXT_SMALL: 'TEXT_SMALL',
  TEXT_LARGE: 'TEXT_LARGE',
} as const;
