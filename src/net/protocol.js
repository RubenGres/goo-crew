// Co-op wire protocol. Host is authoritative: clients send commands + cursor,
// host sends full state snapshots. Plain JSON messages tagged with `t`.

export const MSG = {
  HELLO: "hello",
  WELCOME: "welcome",
  CMD: "cmd", // client -> host: {t, d: command}
  CURSOR: "cursor", // client -> host: {t, x, y} (screen-normalized partner cursor)
  SNAPSHOT: "snapshot", // host -> client: {t, d: serialized game state, cursor}
  PING: "ping",
  PONG: "pong",
  BYE: "bye",
};

export const PROTOCOL_VERSION = 1;

export const encode = (m) => JSON.stringify(m);
export const decode = (d) => (typeof d === "string" ? JSON.parse(d) : d);
