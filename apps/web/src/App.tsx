import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import ChitHome from './pages/ChitHome';
import ChitIn15Lines from './pages/ChitIn15Lines';
import Docs from './pages/Docs';
import ElizaPlugin from './pages/ElizaPlugin';
import FrameworkAdapters from './pages/FrameworkAdapters';
import CloudflareDocs from './pages/CloudflareDocs';
import OpenClawDocs from './pages/OpenClawDocs';
import AcpDocs from './pages/AcpDocs';
import SwarmPlatforms from './pages/SwarmPlatforms';
import Pricing from './pages/Pricing';
import GatewayV1 from './pages/GatewayV1';
import NotFound from './pages/NotFound';
import Security from './pages/Security';
import IssuerTrust from './pages/IssuerTrust';
import AgentShop from './pages/AgentShop';
import Book from './pages/Book';
import BookBot from './pages/BookBot';
import Register from './pages/Register';
import PrivateSpendDocs from './pages/PrivateSpendDocs';
import { isChitHost } from './hostConfig';

function HomePage() {
  return isChitHost() ? <ChitHome /> : <Home />;
}

export default function App() {
  return (
    <Routes>
      {/* Layout wrapper (no path) ensures all routes render within the shell. */}
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/chit-in-15-lines" element={<ChitIn15Lines />} />
        <Route path="/docs/eliza" element={<ElizaPlugin />} />
        <Route path="/docs/framework-adapters" element={<FrameworkAdapters />} />
        <Route path="/docs/langchain" element={<FrameworkAdapters />} />
        <Route path="/docs/ai-sdk" element={<FrameworkAdapters />} />
        <Route path="/docs/cloudflare" element={<CloudflareDocs />} />
        <Route path="/docs/openclaw" element={<OpenClawDocs />} />
        <Route path="/docs/acp" element={<AcpDocs />} />
        <Route path="/docs/private-spend" element={<PrivateSpendDocs />} />
        <Route path="/docs/swarm-platforms" element={<SwarmPlatforms />} />
        <Route path="/docs/olas" element={<SwarmPlatforms />} />
        <Route path="/docs/theoriq" element={<SwarmPlatforms />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/security" element={<Security />} />
        <Route path="/trust" element={<IssuerTrust />} />
        <Route path="/v1" element={<GatewayV1 />} />
        <Route path="/v1/*" element={<GatewayV1 />} />
        <Route path="/agent-shop" element={<AgentShop />} />
        <Route path="/book" element={<Book />} />
        <Route path="/register" element={<Register />} />
        <Route path="/book-bot" element={<BookBot />} />
        {/* Catch-all: branded 404 for ALL unknown paths including gated legacy pages. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
