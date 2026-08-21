import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Docs from './pages/Docs';
import Pricing from './pages/Pricing';
import GatewayV1 from './pages/GatewayV1';
import NotFound from './pages/NotFound';
import Security from './pages/Security';

export default function App() {
  return (
    <Routes>
      {/* Layout wrapper (no path) ensures all routes render within the shell. */}
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/security" element={<Security />} />
        <Route path="/v1" element={<GatewayV1 />} />
        <Route path="/v1/*" element={<GatewayV1 />} />
        {/* Catch-all: branded 404 for ALL unknown paths including gated legacy pages. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
