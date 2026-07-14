import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import DiscordSettings from './pages/DiscordSettings';
import ImportServer from './pages/ImportServer';
import Login from './pages/Login';
import ServerDetail from './pages/ServerDetail';
import Users from './pages/Users';

export default function App() {
  const { user, loading } = useAuth();

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
