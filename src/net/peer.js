import { Peer } from "peerjs";

// WebRTC transport via PeerJS's public broker — no server of our own.
// Host claims a peer id derived from a 4-letter room code; client dials it.
// (Same battle-tested pattern as the train game, different room namespace.)

const ROOM_PREFIX = "goocrew-";

function peerIdForRoom(code) {
  return ROOM_PREFIX + code.toLowerCase();
}

export function makeRoomCode(len = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

class PeerTransport {
  constructor() {
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.peer = null;
    this.conn = null;
    this._closed = false;
    this.ownsPeer = true;
  }

  _bindConn(conn) {
    this.conn = conn;
    conn.on("data", (d) => {
      if (!this._closed && this.onMessage) this.onMessage(d);
    });
    conn.on("open", () => {
      if (!this._closed && this.onOpen) this.onOpen();
    });
    conn.on("close", () => this.close());
    conn.on("error", () => this.close());
    if (conn.open && !this._closed && this.onOpen) this.onOpen();
  }

  send(data) {
    if (this._closed || !this.conn || !this.conn.open) return;
    this.conn.send(data);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      if (this.conn) this.conn.close();
    } catch {}
    if (this.ownsPeer) {
      try {
        if (this.peer) this.peer.destroy();
      } catch {}
    }
    if (this.onClose) this.onClose();
  }
}

// Host: claim the room id, accept connections; each one is wrapped in its own
// transport handed to onPeerConnect.
export function createHostServer(roomCode, { onReady, onPeerConnect } = {}) {
  const peer = new Peer(peerIdForRoom(roomCode), { debug: 1 });
  const transports = new Set();
  let closed = false;

  peer.on("open", () => onReady?.(null));
  peer.on("error", (e) => onReady?.(e));
  peer.on("connection", (conn) => {
    if (closed) {
      conn.close();
      return;
    }
    const tr = new PeerTransport();
    tr.peer = peer;
    tr.ownsPeer = false;
    tr.open = () => tr._bindConn(conn);
    transports.add(tr);
    const origClose = tr.close.bind(tr);
    tr.close = () => {
      transports.delete(tr);
      origClose();
    };
    onPeerConnect?.(tr);
  });

  return {
    peer,
    close() {
      if (closed) return;
      closed = true;
      for (const tr of transports) {
        try {
          tr.close();
        } catch {}
      }
      transports.clear();
      try {
        peer.destroy();
      } catch {}
    },
  };
}

export function createClientTransport(roomCode, onReady) {
  const tr = new PeerTransport();
  tr.peer = new Peer({ debug: 1 });
  tr.open = () => {};
  tr.peer.on("open", () => {
    const conn = tr.peer.connect(peerIdForRoom(roomCode), { reliable: true });
    tr._bindConn(conn);
    onReady?.(null);
  });
  tr.peer.on("error", (e) => onReady?.(e));
  return tr;
}
