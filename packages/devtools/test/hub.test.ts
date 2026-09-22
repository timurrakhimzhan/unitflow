import { assert, describe, it } from "@effect/vitest";
import type { Debug } from "@unitflow/core";
import * as Effect from "effect/Effect";
import { WebSocket } from "ws";
import { AppHub, layerHub, type HubOptions } from "../src/mcp.js";
import type { BridgeMessage, HubMessage } from "../src/protocol.js";

const event = (seq: number, name: string, cause?: number): Debug.DebugEvent => ({
  seq,
  time: seq,
  type: "write",
  name,
  id: `store-${seq}`,
  ...(cause === undefined ? {} : { cause }),
});

const snapshot: Debug.Snapshot = {
  instances: [{ model: "app/task", key: { id: "1" }, leases: 2 }],
  stores: [
    { id: "s1", name: "app/task(1).outputs.title", value: "Write tests", derived: false },
  ],
};

// The hub binds a real socket, so every test gets its own port: a server
// still closing from the previous one would fail the next with EADDRINUSE.
let nextPort = 4600;
const hubOn = (options?: Omit<HubOptions, "port">) => {
  const port = ++nextPort;
  return { port, layer: layerHub({ ...options, port }) };
};

/** A bridge-shaped client: dials the hub and answers snapshot requests. */
const bridge = (port: number) =>
  Effect.acquireRelease(
    Effect.callback<WebSocket>((resume) => {
      const socket = new WebSocket(`ws://localhost:${port}`);
      socket.on("open", () => resume(Effect.succeed(socket)));
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as HubMessage;
        if (message.type === "snapshot_request") {
          socket.send(
            JSON.stringify({ type: "snapshot", requestId: message.requestId, snapshot }),
          );
        }
      });
    }),
    (socket) => Effect.sync(() => socket.close()),
  );

/** The hub reads the socket in a `ws` callback, outside the Effect runtime:
 * a test has to let the event loop turn before asserting on the buffer. */
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 30)));

const send = (socket: WebSocket, message: BridgeMessage) =>
  Effect.sync(() => socket.send(JSON.stringify(message))).pipe(Effect.andThen(settle));

describe("@unitflow/devtools hub", () => {
  it.effect("buffers the events a bridge streams, and replays them by sequence", () => {
    const { port, layer } = hubOn();
    return Effect.gen(function* () {
      const hub = yield* AppHub;
      const socket = yield* bridge(port);

      yield* send(socket, { type: "hello", app: "test-app" });
      yield* send(socket, { type: "events", events: [event(1, "a"), event(2, "b")] });

      assert.deepStrictEqual(
        hub.events().map((recorded) => recorded.name),
        ["a", "b"],
      );
      assert.deepStrictEqual(
        hub.events(1).map((recorded) => recorded.name),
        ["b"],
      );
      assert.isTrue(hub.connected());
    }).pipe(Effect.provide(layer));
  });

  it.effect("drops the oldest events past its capacity", () => {
    const { port, layer } = hubOn({ capacity: 2 });
    return Effect.gen(function* () {
      const hub = yield* AppHub;
      const socket = yield* bridge(port);

      yield* send(socket, {
        type: "events",
        events: [event(1, "a"), event(2, "b"), event(3, "c")],
      });

      assert.deepStrictEqual(
        hub.events().map((recorded) => recorded.name),
        ["b", "c"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("clears the buffer when a reloaded bridge says hello again", () => {
    const { port, layer } = hubOn();
    return Effect.gen(function* () {
      const hub = yield* AppHub;
      const socket = yield* bridge(port);

      yield* send(socket, { type: "events", events: [event(1, "stale")] });
      yield* send(socket, { type: "hello", app: "test-app" });

      assert.deepStrictEqual(hub.events(), []);
    }).pipe(Effect.provide(layer));
  });

  it.effect("ignores a malformed message instead of dropping the connection", () => {
    const { port, layer } = hubOn();
    return Effect.gen(function* () {
      const hub = yield* AppHub;
      const socket = yield* bridge(port);

      yield* Effect.sync(() => socket.send("not json")).pipe(Effect.andThen(settle));
      yield* send(socket, { type: "events", events: [event(1, "after")] });

      assert.deepStrictEqual(
        hub.events().map((recorded) => recorded.name),
        ["after"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("asks the connected bridge for a snapshot and returns its reply", () => {
    const { port, layer } = hubOn();
    return Effect.gen(function* () {
      const hub = yield* AppHub;
      yield* bridge(port);

      assert.deepStrictEqual(yield* hub.snapshot, snapshot);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails a snapshot with a usable message when no app is connected", () => {
    const { layer } = hubOn();
    return Effect.gen(function* () {
      const hub = yield* AppHub;

      const error = yield* Effect.flip(hub.snapshot);

      assert.include(error.message, "No app connected");
      assert.isFalse(hub.connected());
    }).pipe(Effect.provide(layer));
  });
});
