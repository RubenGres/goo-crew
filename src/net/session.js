import { MSG, PROTOCOL_VERSION, encode, decode } from "./protocol.js";

// Role-aware session over any transport exposing onOpen/onMessage/onClose,
// send(), close(), open(). Same shape as the train game's netcode: the host
// answers HELLO with WELCOME, then streams snapshots; the client streams
// commands. Both ping for liveness.

export class NetSession {
  constructor(role, transport, handlers = {}) {
    this.role = role; // "host" | "client"
    this.transport = transport;
    this.handlers = handlers; // { onConnect, onDisconnect, onCmd, onCursor, onSnapshot, onLatency }
    this.connected = false;
    this.rtt = 0;
    this.lastRecv = 0;
    this._pingTimer = null;
  }

  start() {
    const tr = this.transport;
    tr.onOpen = () => {
      if (this.role === "client") this._send({ t: MSG.HELLO, v: PROTOCOL_VERSION });
    };
    tr.onMessage = (data) => this._onMessage(data);
    tr.onClose = () => this._onClose();
    tr.open();
    return this;
  }

  _send(obj) {
    this.transport.send(encode(obj));
  }

  _onMessage(data) {
    let msg;
    try {
      msg = decode(data);
    } catch {
      return;
    }
    this.lastRecv = now();
    switch (msg.t) {
      case MSG.HELLO:
        if (this.role === "host") {
          if (msg.v !== PROTOCOL_VERSION) {
            this._send({ t: MSG.BYE, reason: "version" });
            return;
          }
          this._send({ t: MSG.WELCOME, v: PROTOCOL_VERSION });
          this._markConnected();
        }
        break;
      case MSG.WELCOME:
        if (this.role === "client") this._markConnected();
        break;
      case MSG.CMD:
        if (this.role === "host") this.handlers.onCmd?.(msg.d);
        break;
      case MSG.CURSOR:
        this.handlers.onCursor?.(msg);
        break;
      case MSG.SNAPSHOT:
        if (this.role === "client") this.handlers.onSnapshot?.(msg.d, msg);
        break;
      case MSG.PING:
        this._send({ t: MSG.PONG, ts: msg.ts });
        break;
      case MSG.PONG:
        this.rtt = Math.max(0, now() - msg.ts);
        this.handlers.onLatency?.(this.rtt);
        break;
      case MSG.BYE:
        this._onClose();
        break;
    }
  }

  _markConnected() {
    if (this.connected) return;
    this.connected = true;
    this.lastRecv = now();
    this.handlers.onConnect?.();
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      this._send({ t: MSG.PING, ts: now() });
      if (now() - this.lastRecv > 9000) this._onClose();
    }, 1500);
  }

  _onClose() {
    if (!this.connected) return;
    this.connected = false;
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    this.handlers.onDisconnect?.();
  }

  sendSnapshot(d, cursor) {
    if (this.role !== "host" || !this.connected) return;
    this._send({ t: MSG.SNAPSHOT, d, cursor });
  }

  sendCmd(d) {
    if (this.role !== "client" || !this.connected) return;
    this._send({ t: MSG.CMD, d });
  }

  sendCursor(x, y) {
    if (!this.connected) return;
    this._send({ t: MSG.CURSOR, x, y });
  }

  close() {
    try {
      this._send({ t: MSG.BYE });
    } catch {}
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    this.connected = false;
    this.transport.close();
  }
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
