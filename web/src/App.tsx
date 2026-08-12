import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Account from './pages/Account';
import Dashboard from './pages/Dashboard';
import DiscordSettings from './pages/DiscordSettings';
import ImportServer from './pages/ImportServer';
import InviteSignup from './pages/InviteSignup';
import Login from './pages/Login';
import Logs from './pages/Logs';
import ServerDetail from './pages/ServerDetail';
import Users from './pages/Users';
import WowAccountLink from './pages/WowAccountLink';

function WowAccountLinkRoute() {
  const { token } = useParams();
  return <WowAccountLink token={token || ''} />;
}

function InviteSignupRoute() {
  const { token } = useParams();
  return <InviteSignup token={token || ''} />;
}

export default function App() {
  const { user, loading } = useAuth();
  const path = window.location.pathname;
  const isWowAccountPath = path.startsWith('/wow-account/');
  const isInvitePath = path.startsWith('/invite/');

  // Publicly accessible regardless of login state — identity is proven by possessing the token, not a Stormsmith account.
  if (isWowAccountPath || isInvitePath) {
    return (
      <Routes>
        <Route path="/wow-account/:token" element={<WowAccountLinkRoute />} />
        <Route path="/invite/:token" element={<InviteSignupRoute />} />
      </Routes>
    );
  }

  if (loading) {
    return <div className="center-screen">Loading…</div>;
  }
  if (!user) {
    return <Login />;
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/account" element={<Account />} />
        {user.role === 'admin' && (
          <>
            <Route path="/import" element={<ImportServer />} />
            <Route path="/users" element={<Users />} />
            <Route path="/discord" element={<DiscordSettings />} />
            <Route path="/logs" element={<Logs />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
