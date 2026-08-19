import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Bridge from './pages/Bridge';
import Dashboard from './pages/Dashboard';
import Governance from './pages/Governance';
import Circuits from './pages/Circuits';
import ThetaAI from './pages/ThetaAI';
import Monitoring from './pages/Monitoring';
import Staking from './pages/Staking';
import Treasury from './pages/Treasury';
import Docs from './pages/Docs';
import Pricing from './pages/Pricing';
import Community from './pages/Community';
import Grants from './pages/Grants';
import EscrowAdmin from './pages/EscrowAdmin';
import Security from './pages/Security';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs" element={<Docs />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="security" element={<Security />} />
        {/* Legacy protocol pages — not in nav. Kept so old links do not 404. */}
        <Route path="bridge" element={<Bridge />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="governance" element={<Governance />} />
        <Route path="circuits" element={<Circuits />} />
        <Route path="theta-ai" element={<ThetaAI />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="staking" element={<Staking />} />
        <Route path="treasury" element={<Treasury />} />
        <Route path="community" element={<Community />} />
        <Route path="grants" element={<Grants />} />
        {/* Funding rounds pulled from the public UI (not open); redirect legacy links home. */}
        <Route path="believers" element={<Navigate to="/" replace />} />
        <Route path="angels" element={<Navigate to="/" replace />} />
        <Route path="escrow-admin" element={<EscrowAdmin />} />
      </Route>
    </Routes>
  );
}
