import type { Debug } from "@unitflow/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as McpServer from "effect/unstable/ai/McpServer";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { DEFAULT_PORT, type BridgeMessage, type HubMessage } from "./protocol.js";

/**
 * The hub side of the devtools bridge: accepts one (latest) app connection,
 * accumulates its event log, and answers snapshot requests on demand.
 */
export interface AppHubService {
  readonly events: (sinceSeq?: number) => ReadonlyArray<Debug.DebugEvent>;
  readonly snapshot: Effect.Effect<Debug.Snapshot, HubError>;
  readonly connected: () => boolean;
}

export class HubError extends Schema.ErrorClass<HubError>("unitflow/devtools/HubError")({
  _tag: Schema.tag("HubError"),
  message: Schema.String,
}) {}

export class AppHub extends Context.Service<AppHub, AppHubService>()(
  "@unitflow/devtools/AppHub",
) {}

export interface HubOptions {
  readonly port?: number;
  /** How many events the hub keeps; the oldest are dropped past it. */
  readonly capacity?: number;
}

/** Starts the WebSocket hub the in-app bridge dials into. */
export const layerHub = (options?: HubOptions): Layer.Layer<AppHub> =>
  Layer.effect(
    AppHub,
    Effect.gen(function* () {
      const port = options?.port ?? DEFAULT_PORT;
      const capacity = options?.capacity ?? 10_000;

      let app: WsSocket | undefined;
      let buffer: Array<Debug.DebugEvent> = [];
      let nextRequestId = 0;
      const pendingSnapshots = new Map<number, (snapshot: Debug.Snapshot) => void>();

      const server = yield* Effect.acquireRelease(
        Effect.sync(() => new WebSocketServer({ port })),
        (wss) => Effect.sync(() => wss.close()),
      );

      server.on("connection", (socket) => {
        // The latest connection wins: a page reload replaces the old bridge.
        app?.close();
        app = socket;
        socket.on("message", (raw) => {
          let message: BridgeMessage;
          try {
            // eslint-disable-next-line revizo/no-type-assertion
            message = JSON.parse(String(raw)) as BridgeMessage;
          } catch {
            return;
          }
          if (message.type === "events") {
            buffer.push(...message.events);
            if (buffer.length > capacity) buffer = buffer.slice(buffer.length - capacity);
          } else if (message.type === "snapshot") {
            const resolve = pendingSnapshots.get(message.requestId);
            if (resolve !== undefined) {
              pendingSnapshots.delete(message.requestId);
              resolve(message.snapshot);
            }
          } else if (message.type === "hello") {
            // A fresh bridge replays its whole inspector buffer: reset ours so
            // sequence numbers stay consistent.
            buffer = [];
          }
        });
        socket.on("close", () => {
          if (app === socket) app = undefined;
        });
      });

      const snapshot = Effect.callback<Debug.Snapshot, HubError>((resume) => {
        if (app === undefined) {
          resume(
            Effect.fail(
              new HubError({ message: "No app connected. Is the dev bridge running?" }),
            ),
          );
          return;
        }
        const requestId = ++nextRequestId;
        const timeout = setTimeout(() => {
          pendingSnapshots.delete(requestId);
          resume(Effect.fail(new HubError({ message: "Snapshot request timed out." })));
        }, 5_000);
        pendingSnapshots.set(requestId, (received) => {
          clearTimeout(timeout);
          resume(Effect.succeed(received));
        });
        const request: HubMessage = { type: "snapshot_request", requestId };
        app.send(JSON.stringify(request));
      });

      return {
        events: (sinceSeq) =>
          sinceSeq === undefined ? [...buffer] : buffer.filter((event) => event.seq > sinceSeq),
        snapshot,
        connected: () => app !== undefined,
      };
    }),
  );

// --- MCP tools ------------------------------------------------------------

const DebugEventSchema = Schema.Struct({
  seq: Schema.Number,
  time: Schema.Number,
  type: Schema.String,
  name: Schema.String,
  id: Schema.String,
  value: Schema.optional(Schema.Unknown),
  cause: Schema.optional(Schema.Number),
});

const listInstances = Tool.make("list_instances", {
  description:
    "Lists every live unitflow model instance in the connected app: model id, instance key, and how many lease holders keep it alive.",
  success: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      key: Schema.optional(Schema.Unknown),
      leases: Schema.Number,
    }),
  ),
  failure: HubError,
});

const getStores = Tool.make("get_stores", {
  description:
    "Lists materialized stores with their current values. Optionally filter by substring of the store name (names look like `app/task(42).outputs.state`).",
  parameters: Schema.Struct({
    filter: Schema.optional(Schema.String),
  }),
  success: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      value: Schema.Unknown,
      derived: Schema.optional(Schema.Boolean),
    }),
  ),
  failure: HubError,
})

const eventLog = Tool.make("event_log", {
  description:
    "Returns the recorded runtime events (writes, emits, instance lifecycle), oldest first. `cause` links an event to the publication whose synchronous dispatch produced it. Filter by name substring and/or sequence number.",
  parameters: Schema.Struct({
    since_seq: Schema.optional(Schema.Number),
    filter: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(DebugEventSchema),
});

const trace = Tool.make("trace", {
  description:
    "Traces the causal chain of one event by its `seq`: every ancestor up to the root publication, and every recorded descendant.",
  parameters: Schema.Struct({
    seq: Schema.Number,
  }),
  success: Schema.Struct({
    chain: Schema.Array(DebugEventSchema),
    descendants: Schema.Array(DebugEventSchema),
  }),
});

export const toolkit = Toolkit.make(listInstances, getStores, eventLog, trace);

export const toolkitLayer = toolkit.toLayer(
  Effect.gen(function* () {
    const hub = yield* AppHub;
    return {
      list_instances: () =>
        Effect.map(hub.snapshot, (snapshot) => snapshot.instances),
      get_stores: ({ filter }) =>
        Effect.map(hub.snapshot, (snapshot) =>
          snapshot.stores.filter(
            (store) => filter === undefined || (store.name ?? store.id).includes(filter),
          ),
        ),
      event_log: ({ since_seq, filter, limit }) =>
        Effect.sync(() => {
          let events = hub.events(since_seq);
          if (filter !== undefined) {
            events = events.filter((event) => event.name.includes(filter));
          }
          if (limit !== undefined && events.length > limit) {
            events = events.slice(events.length - limit);
          }
          return events;
        }),
      trace: ({ seq }) =>
        Effect.sync(() => {
          const events = hub.events();
          const bySeq = new Map(events.map((event) => [event.seq, event]));
          const chain: Array<Debug.DebugEvent> = [];
          let current = bySeq.get(seq);
          while (current !== undefined) {
            chain.unshift(current);
            current = current.cause === undefined ? undefined : bySeq.get(current.cause);
          }
          const descendants: Array<Debug.DebugEvent> = [];
          const frontier = new Set([seq]);
          for (const event of events) {
            if (event.cause !== undefined && frontier.has(event.cause)) {
              descendants.push(event);
              frontier.add(event.seq);
            }
          }
          return { chain, descendants };
        }),
    };
  }),
);

export interface ServerOptions extends HubOptions {
  readonly name?: string;
  readonly version?: string;
}

/** The full MCP server over stdio: hub + tools + protocol. Provide a `Stdio`
 * implementation (see `bin.ts` for the node one). */
export const layer = (options?: ServerOptions) =>
  Layer.mergeAll(
    McpServer.toolkit(toolkit).pipe(Layer.provide(toolkitLayer)),
  ).pipe(
    Layer.provideMerge(
      McpServer.layerStdio({
        name: options?.name ?? "unitflow-devtools",
        version: options?.version ?? "0.1.0",
      }),
    ),
    Layer.provideMerge(layerHub(options)),
  );
