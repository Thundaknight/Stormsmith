import { useEffect, useRef, useState } from 'react';
import { getToken } from './api';
import type { ServerStatusUpdate } from './types';

interface StatusMessage {
  type: 'status';
  servers: ServerStatusUpdate[];
  dockerError: string;
}

/** Live server status over WebSocket, with automatic reconnect. */
export function useStatusSocket(enabled: boolean) {
  const [statuses, setStatuses] = useState<Map<number, ServerStatusUpdate>>(new Map());
  const [dockerError, setDockerError] = useState('');
  const retryRef = useRef<number>(1000);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(getToken())}`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as StatusMessage;
          if (msg.type === 'status') {
            setStatuses(new Map(msg.servers.map((s) => [s.serverId, s])));
            setDockerError(msg.dockerError || '');
            retryRef.current = 1000;
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 15000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]);

  return { statuses, dockerError };
}
