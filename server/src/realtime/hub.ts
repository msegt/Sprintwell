import type { WebSocket } from 'ws';
import type { Repo } from '../repo';
import { EMPTY_CONN_STATE, Realtime, type ConnState, type Connection, type Log } from './core';

interface NodeConn extends Connection {
  socket: WebSocket;
  alive: boolean;
  state: ConnState;
}

/** WebSocket hub for the Node server: keeps connections in memory and pings them. */
export class Hub extends Realtime {
  private conns: Set<NodeConn>;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(repo: Repo, log: Log) {
    const conns = new Set<NodeConn>();
    super(repo, log, { all: (): Connection[] => [...conns] });
    this.conns = conns;
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) {
          c.socket.terminate();
          continue;
        }
        c.alive = false;
        c.socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.dispose();
    for (const c of this.conns) c.socket.close(1001, 'Server shutting down');
  }

  accept(socket: WebSocket): void {
    const conn: NodeConn = {
      socket,
      alive: true,
      state: { ...EMPTY_CONN_STATE },
      get key() {
        return this;
      },
      getState() {
        return this.state;
      },
      setState(s) {
        this.state = s;
      },
      send(text) {
        if (socket.readyState === socket.OPEN) socket.send(text);
      },
      close(code, reason) {
        socket.close(code, reason);
      },
    };
    this.conns.add(conn);
    const authTimer = setTimeout(() => {
      if (!conn.state.userId) socket.close(4001, 'Authentication required');
    }, 10_000);

    socket.on('pong', () => (conn.alive = true));
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.conns.delete(conn);
      void this.onClose(conn);
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (data) => {
      conn.alive = true;
      void this.onMessage(conn, String(data));
    });
  }
}
