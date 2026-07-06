import type { Debug } from "@unitflow/core";
import { DEFAULT_PORT, type BridgeMessage, type HubMessage } from "./protocol.js";

export interface BridgeOptions {
  /** The MCP hub address; defaults to `ws://localhost:4477`. */
  readonly url?: string;
  /** How the app introduces itself to the hub. */
  readonly app?: string;
  /** How often buffered inspector events are flushed, in milliseconds. */
  readonly flushInterval?: number;
}

/**
 * Streams an attached inspector to the local MCP hub over WebSocket: event
 * batches on an interval, full snapshots on the hub's request. Dev-only,
 * dependency-free (browser `WebSocket`), reconnects with a fixed backoff.
 * Returns a stop function.
 */
export const connect = (inspector: Debug.Inspector, options?: BridgeOptions): (() => void) => {
  const url = options?.url ?? `ws://localhost:${DEFAULT_PORT}`;
  const app = options?.app ?? "unitflow-app";
  const flushInterval = options?.flushInterval ?? 200;

  let socket: WebSocket | undefined;
  let stopped = false;
  let lastSeq = 0;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  // Store values and payloads are arbitrary app objects: functions, bigints
  // and cycles must degrade to placeholders instead of killing the batch.
  // Cycle detection tracks the CURRENT PATH only — the same object shared by
  // two branches (a store value appearing in a combined snapshot too) is not
  // a cycle and serializes in full everywhere.
  const toSerializable = (value: unknown, path: WeakSet<object>): unknown => {
    if (typeof value === "function") return "[function]";
    if (typeof value === "bigint") return String(value);
    if (typeof value !== "object" || value === null) return value;
    if (path.has(value)) return "[circular]";
    path.add(value);
    const result = Array.isArray(value)
      ? value.map((item) => toSerializable(item, path))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toSerializable(item, path)]),
        );
    path.delete(value);
    return result;
  };

  const safeStringify = (message: BridgeMessage): string =>
    JSON.stringify(toSerializable(message, new WeakSet()));

  const send = (message: BridgeMessage): void => {
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      socket.send(safeStringify(message));
    }
  };

  const flush = (): void => {
    const events = inspector.events(lastSeq);
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (last !== undefined) lastSeq = last.seq;
    send({ type: "events", events });
  };

  const open = (): void => {
    if (stopped) return;
    socket = new WebSocket(url);
    socket.onopen = () => {
      send({ type: "hello", app });
      // The hub may have restarted: replay everything still buffered.
      lastSeq = 0;
      flush();
      flushTimer = setInterval(flush, flushInterval);
    };
    socket.onmessage = (raw) => {
      // A malformed hub message only skips that message.
      let message: HubMessage;
      try {
        message = JSON.parse(String(raw.data)) as HubMessage;
      } catch {
        return;
      }
      if (message.type === "snapshot_request") {
        send({
          type: "snapshot",
          requestId: message.requestId,
          snapshot: inspector.snapshot(),
        });
      }
    };
    socket.onclose = () => {
      if (flushTimer !== undefined) clearInterval(flushTimer);
      flushTimer = undefined;
      if (!stopped) reconnectTimer = setTimeout(open, 2_000);
    };
    socket.onerror = () => {
      socket?.close();
    };
  };

  open();

  return () => {
    stopped = true;
    if (flushTimer !== undefined) clearInterval(flushTimer);
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    socket?.close();
  };
};
