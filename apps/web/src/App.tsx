import { Routes, Route, Navigate } from 'react-router-dom';
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
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs" element={<Docs />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="security" element={<Security />} />
        <Route path="v1" element={<GatewayV1 />} />
        <Route path="v1/*" element={<GatewayV1 />} />
        {/* Funding rounds pulled from the public UI (not open); redirect legacy links home. */}
        <Route path="believers" element={<Navigate to="/" replace />} />
        <Route path="angels" element={<Navigate to="/" replace />} />
        {/* Catch-all: branded 404 for all unknown routes including gated legacy pages. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
