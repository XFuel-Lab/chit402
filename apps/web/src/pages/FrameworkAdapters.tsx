import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';

const langchainExample = `npm install chit402-adapters @langchain/openai

import { createChitChatOpenAI } from 'chit402-adapters/langchain';
import { extractReceipt } from 'chit402-adapters/receipt';

const llm = await createChitChatOpenAI({
  apiKey: process.env.CHIT_API_KEY, // optional partner key; omit for x402-paid /v1
  model: 'xfuel/auto',
});

const res = await llm.invoke('Summarize this receipt in one sentence.');
const raw = (res as { response_metadata?: { body?: unknown } }).response_metadata?.body;
const receipt = extractReceipt(raw as Record<string, unknown>, 'https://api.chit402.com');
console.log(receipt.verify_url); // hold the row`;

const aiSdkExample = `npm install chit402-adapters @ai-sdk/openai ai

import { generateText } from 'ai';
import { createChit } from 'chit402-adapters/ai-sdk';
import { extractReceipt } from 'chit402-adapters/receipt';

const chit = await createChit();
const { text, response } = await generateText({
  model: chit('xfuel/auto'),
  prompt: 'Say hello in five words.',
});

const body = (await response.json()) as Record<string, unknown>;
const receipt = extractReceipt(body, 'https://api.chit402.com', response.headers);
console.log(text, receipt.verify_url);`;

const envExample = `# CHIT_API_URL=https://api.chit402.com
# CHIT_API_KEY=<partner-key>
# CHIT_MAX_USD_PER_CALL=0.10
# CHIT_MAX_USD_SESSION=1.00`;

export default function FrameworkAdapters() {
  const apiV1 = getApiV1();

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Framework</span>
          <h1>LangChain + AI SDK</h1>
          <p>
            Swap <code>baseURL</code> to <code>{apiV1}</code>, pay USDC on Base, hold{' '}
            <code>verify_url</code>. Chit402 is the book — hub, model, amount — not a cheaper
            inference router.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Install</h2>
          <pre className="docs-code">
            <code>{`npm install chit402-adapters
# plus @langchain/openai or @ai-sdk/openai + ai`}</code>
          </pre>
          <p style={styles.note}>
            Canonical package: <code>@xfuel/adapters</code>. Public alias:{' '}
            <code>chit402-adapters</code>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>LangChain</h2>
          <p>
            Factory for <code>ChatOpenAI</code> pointed at Chit. Paid x402 calls
            return a signed receipt.
          </p>
          <pre className="docs-code">
            <code>{langchainExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Vercel AI SDK</h2>
          <p>
            <code>createChit()</code> wraps <code>createOpenAI</code> with the Chit baseURL. Use{' '}
            <code>generateText</code> or any AI SDK helper — extract the receipt from the raw
            response.
          </p>
          <pre className="docs-code">
            <code>{aiSdkExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Environment</h2>
          <pre className="docs-code">
            <code>{envExample}</code>
          </pre>
        </div>

        <div className="docs-actions">
          <Link to="/docs/chit-in-15-lines" className="btn btn-primary btn-sm">
            Chit in 15 lines
          </Link>
          <Link to="/docs/eliza" className="btn btn-secondary btn-sm">
            Eliza plugin
          </Link>
          <a
            href="https://github.com/XFuel-Lab/chit402/tree/main/packages/adapters"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Source
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  note: { marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 },
};
