import type { GenerateTextParams, IAgentRuntime } from './eliza-types.js';
import { ChainId, type ChatMessage } from 'xfuel-sdk';
import type { RuntimeState } from './types.js';
import {
  enforceSpendCaps,
  getRuntimeState,
  recordReceiptSpend,
} from './state.js';
import {
  pushReceipt,
  receiptFromChatXfuel,
  receiptFromTaskStatus,
} from './receipts.js';

function buildMessages(runtime: IAgentRuntime, prompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const system = runtime.character?.system;
  if (typeof system === 'string' && system.trim()) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function logReceipt(
  runtime: IAgentRuntime,
  receipt: { task_id: string; verify_url: string },
): void {
  const logger = runtime.logger;
  if (logger?.info) {
    logger.info(`[chit402] receipt task_id=${receipt.task_id} verify_url=${receipt.verify_url}`);
  } else {
    console.info(`[chit402] receipt task_id=${receipt.task_id} verify_url=${receipt.verify_url}`);
  }
}

async function handleDemoPath(
  state: RuntimeState,
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await state.client.chatCompletions({
    model,
    messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  });
  const text = res.choices?.[0]?.message?.content ?? '';
  const cached = receiptFromChatXfuel(res.xfuel, res.model ?? model, state.config.apiUrl);
  if (cached) {
    state.receipts = pushReceipt(state.receipts, cached);
    recordReceiptSpend(state, cached.gross_amount);
    logReceipt(runtime, cached);
  }
  return text;
}

async function handlePaidPath(
  state: RuntimeState,
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!state.payer) {
    throw new Error('Chit402 paid path requires CHIT_PAYER_PK (EIP-3009 signer on Base).');
  }

  const quote = await state.client.quoteTask({
    model_id: model,
    messages,
    max_tokens: params.maxTokens,
  });
  const usdcAmount = quote.rails.usdc.amount;
  if (!usdcAmount) {
    throw new Error('Chit402 quote returned no USDC amount for paid inference.');
  }
  await enforceSpendCaps(state, usdcAmount);

  const task = await state.client.submitInference(model, state.sender, usdcAmount, {
    chain_id: ChainId.BASE,
    messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    payment: {
      rail: 'usdc',
      network: state.config.network,
      maxAmount: usdcAmount,
    },
    payer: state.payer,
  });

  const settled = await state.client.waitForCompletion(task.task_id);
  if (settled.status === 'failed') {
    const msg = settled.error?.message ?? 'Chit402 paid inference failed';
    throw new Error(msg);
  }

  const cached = receiptFromTaskStatus(settled, model, state.config.apiUrl);
  state.receipts = pushReceipt(state.receipts, cached);
  recordReceiptSpend(state, cached.gross_amount);
  logReceipt(runtime, cached);

  const content = settled.result?.content;
  if (typeof content === 'string' && content.length > 0) {
    return content;
  }
  throw new Error(`Chit402 task ${task.task_id} completed without text content.`);
}

/** Map Eliza TEXT_SMALL / TEXT_LARGE to Chit402 chat or paid submit. */
export async function handleChitText(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  kind: 'small' | 'large',
): Promise<string> {
  if (params.stream) {
    runtime.logger?.warn?.(
      '[chit402] Streaming is not supported in v1; use non-streaming useModel calls.',
    );
  }

  const state = await getRuntimeState(runtime);
  const model = kind === 'small' ? state.config.smallModel : state.config.largeModel;
  const messages = buildMessages(runtime, params.prompt);

  if (state.payer) {
    return handlePaidPath(state, runtime, params, model, messages);
  }
  return handleDemoPath(state, runtime, params, model, messages);
}

export { buildMessages };
