/** Local register fixture. The receipt stays on the in-process listener. */
export function regTask({ taskId, address, paymentRef }) {
  return {
    taskId,
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      model: 'theta/qwen3',
      paymentRail: 'usdc',
      paymentRef,
      amount: '100000',
    },
    feeAmount: '500',
    netAmount: '99500',
    feeBps: 50,
    meta: { chain: 'base', provider: 'theta-edgecloud', payerWallet: address },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
  };
}
