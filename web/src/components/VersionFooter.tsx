import { useEffect, useState } from 'react';
import { api } from '../api';

/** Shows the running server's version, e.g. to confirm a Discord bot fix actually deployed. */
export default function VersionFooter() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    api.authStatus().then((r) => setVersion(r.version)).catch(() => {});
  }, []);

  if (!version) return null;
  return <div className="version-footer muted">Stormsmith v{version}</div>;
}
