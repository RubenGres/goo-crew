// In-memory transport pair with the same interface as PeerTransport.
// Lives in its own module (no peerjs import) so node tests can use it.

export function createLoopbackPair() {
  const mk = () => ({
    onOpen: null,
    onMessage: null,
    onClose: null,
    other: null,
    open() {
      queueMicrotask(() => this.onOpen?.());
    },
    send(d) {
      queueMicrotask(() => this.other?.onMessage?.(d));
    },
    close() {
      this.onClose?.();
      this.other?.onClose?.();
    },
  });
  const a = mk();
  const b = mk();
  a.other = b;
  b.other = a;
  return [a, b];
}
