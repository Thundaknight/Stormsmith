import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken, userCan } from './auth';
import { monitor } from './monitor';
import type { AuthTokenPayload, ServerStatus } from './types';

interface AuthedSocket extends WebSocket {
  user?: AuthTokenPayload;
}

/**
 * WebSocket endpoint at /ws?token=<jwt>. Pushes the status list (filtered to
 * the servers the user can view) on connect and on every poll.
 */
export function initWs(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: AuthedSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const payload = verifyToken(url.searchParams.get('token') || '');
    if (!payload) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    ws.user = payload;
    send(ws, monitor.getAll());
  });

  const broadcast = (statuses: ServerStatus[]) => {
    for (const client of wss.clients as Set<AuthedSocket>) {
      if (client.readyState === WebSocket.OPEN && client.user) send(client, statuses);
    }
  };
  monitor.on('update', broadcast);

  function send(ws: AuthedSocket, statuses: ServerStatus[]): void {
    const visible = statuses.filter((s) => ws.user && userCan(ws.user, s.serverId, 'view'));
    ws.send(JSON.stringify({ type: 'status', servers: visible, dockerError: monitor.getLastError() }));
  }
}
