import { Routes, Route } from 'react-router-dom';
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
import Community from './pages/Community';
import Grants from './pages/Grants';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="bridge" element={<Bridge />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="governance" element={<Governance />} />
        <Route path="circuits" element={<Circuits />} />
        <Route path="theta-ai" element={<ThetaAI />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="staking" element={<Staking />} />
        <Route path="treasury" element={<Treasury />} />
        <Route path="docs" element={<Docs />} />
        <Route path="community" element={<Community />} />
        <Route path="grants" element={<Grants />} />
      </Route>
    </Routes>
  );
}
