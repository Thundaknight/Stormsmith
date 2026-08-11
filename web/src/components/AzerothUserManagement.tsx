import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import AzerothAccounts from './AzerothAccounts';
import AzerothPlayerList from './AzerothPlayerList';
import type { WowAccountLink } from '../types';

interface Props {
  serverId: number;
  dbConfigured: boolean;
}

/**
 * Owns the "generated links" list shared by both panels below — a reset
 * link made from the player list and an account-creation link made from
 * Create Account both need to show up in the same table, kept in sync
 * regardless of which panel generated it.
 */
export default function AzerothUserManagement({ serverId, dbConfigured }: Props) {
  const [links, setLinks] = useState<WowAccountLink[]>([]);

  const loadLinks = useCallback(() => {
    api.listWowAccountLinks(serverId).then((r) => setLinks(r.links)).catch(() => {});
  }, [serverId]);

  useEffect(loadLinks, [loadLinks]);

  return (
    <>
      <AzerothPlayerList serverId={serverId} dbConfigured={dbConfigured} onLinkGenerated={loadLinks} />
      <AzerothAccounts serverId={serverId} links={links} onLinksChanged={loadLinks} />
    </>
  );
}
