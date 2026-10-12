import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Overview from './pages/Overview';
import Alerts from './pages/Alerts';
import Investigation from './pages/Investigation';
import Topology from './pages/Topology';
import RoutingFirewall from './pages/RoutingFirewall';
import IdsIps from './pages/IdsIps';
import ResponseAudit from './pages/ResponseAudit';
import SystemHealth from './pages/SystemHealth';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/investigation" element={<Investigation />} />
        <Route path="/investigation/:eventId" element={<Investigation />} />
        <Route path="/topology" element={<Topology />} />
        <Route path="/routing" element={<RoutingFirewall />} />
        <Route path="/ids-ips" element={<IdsIps />} />
        <Route path="/response" element={<ResponseAudit />} />
        <Route path="/system" element={<SystemHealth />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
