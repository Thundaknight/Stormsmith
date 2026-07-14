import net from 'net';
import type { GameServer } from './types';

/**
 * Minimal Source RCON client (Palworld, Minecraft, Rust, ARK, 7DtD, …).
 *
 * Implemented in-house instead of using a library because Palworld's RCON
 * server violates the spec: it replies to every packet with id 0 instead of
 * echoing the request id, which makes strict-matching clients time out
 * ("Timeout for packet id 1"). This client matches responses leniently by
 * phase, which works for both compliant and Palworld-style servers.
 */

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH_RESPONSE = 2;

const TIMEOUT_MS = 5000;
/** After the first response packet, wait briefly for follow-up packets before resolving. */
const RESPONSE_GRACE_MS = 150;

interface Packet {
  id: number;
  type: number;
  body: string;
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + bodyBuf.length);
  buf.writeInt32LE(10 + bodyBuf.length, 0); // size excludes the size field itself
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  // two trailing null bytes are already zero from alloc
  return buf;
}

class PacketReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Packet[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets: Packet[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (size < 10 || size > 4 * 1024 * 1024) throw new Error('Malformed RCON packet from server');
      if (this.buffer.length < 4 + size) break;
      packets.push({
        id: this.buffer.readInt32LE(4),
        type: this.buffer.readInt32LE(8),
        body: this.buffer.subarray(12, 4 + size - 2).toString('utf8'),
      });
      this.buffer = this.buffer.subarray(4 + size);
    }
    return packets;
  }
}

/** Sends a single RCON command; connects per command to avoid stale connections. */
export function sendRconCommand(server: GameServer, command: string): Promise<string> {
  if (!server.rcon_host || !server.rcon_port || !server.rcon_password) {
    return Promise.reject(new Error('RCON is not configured for this server'));
  }
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: server.rcon_host, port: server.rcon_port });
    const reader = new PacketReader();
    const bodies: string[] = [];
    let phase: 'auth' | 'command' = 'auth';
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (graceTimer) clearTimeout(graceTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve(bodies.join(''));
    };

    const overallTimer = setTimeout(() => {
      settle(new Error(
        phase === 'auth'
          ? 'RCON timed out during authentication — check that RCON is enabled on the game server and the port is correct'
          : 'RCON timed out waiting for a response'
      ));
    }, TIMEOUT_MS);

    socket.on('connect', () => {
      socket.write(encodePacket(1, SERVERDATA_AUTH, server.rcon_password));
    });
    socket.on('error', (err) => settle(new Error(`RCON connection failed: ${err.message}`)));
    socket.on('close', () => {
      // Some servers close the socket right after responding
      if (phase === 'command' && bodies.length > 0) settle(null);
      else settle(new Error('RCON connection closed unexpectedly'));
    });

    socket.on('data', (chunk) => {
      let packets: Packet[];
      try {
        packets = reader.push(chunk);
      } catch (err: any) {
        settle(err);
        return;
      }
      for (const packet of packets) {
        if (phase === 'auth') {
          // A compliant server may send an empty RESPONSE_VALUE before the auth
          // response; wait for the AUTH_RESPONSE (type 2) packet.
          if (packet.type !== SERVERDATA_AUTH_RESPONSE) continue;
          if (packet.id === -1) {
            settle(new Error('RCON authentication failed — check the RCON/admin password'));
            return;
          }
          phase = 'command';
          socket.write(encodePacket(2, SERVERDATA_EXECCOMMAND, command));
        } else {
          // Lenient id matching: Palworld replies with id 0 regardless of request id
          bodies.push(packet.body);
          if (graceTimer) clearTimeout(graceTimer);
          graceTimer = setTimeout(() => settle(null), RESPONSE_GRACE_MS);
        }
      }
    });
  });
}

/** Sends an in-game broadcast using the server's game-specific template. */
export async function sendBroadcast(server: GameServer, message: string): Promise<string> {
  if (!server.broadcast_template) throw new Error('No broadcast template configured for this server');
  const command = server.broadcast_template
    .replace('{message}', message)
    .replace('{message_underscored}', message.replace(/ /g, '_'));
  return sendRconCommand(server, command);
}
