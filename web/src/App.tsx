import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Account from './pages/Account';
import Dashboard from './pages/Dashboard';
import DiscordSettings from './pages/DiscordSettings';
import ImportServer from './pages/ImportServer';
import InviteSignup from './pages/InviteSignup';
import Login from './pages/Login';
import ServerDetail from './pages/ServerDetail';
import Users from './pages/Users';
import WowPasswordReset from './pages/WowPasswordReset';

function WowPasswordResetRoute() {
  const { token } = useParams();
  return <WowPasswordReset token={token || ''} />;
}

function InviteSignupRoute() {
  const { token } = useParams();
  return <InviteSignup token={token || ''} />;
}

export default function App() {
  const { user, loading } = useAuth();
  const path = window.location.pathname;
  const isWowResetPath = path.startsWith('/wow-password-reset/');
  const isInvitePath = path.startsWith('/invite/');

  // Publicly accessible regardless of login state — identity is proven by possessing the token, not a Stormsmith account.
  if (isWowResetPath || isInvitePath) {
    return (
      <Routes>
        <Route path="/wow-password-reset/:token" element={<WowPasswordResetRoute />} />
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
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
