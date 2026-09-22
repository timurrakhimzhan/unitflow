import { assert, describe, it } from "@effect/vitest";
import type { Debug } from "@unitflow/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { AppHub, HubError, PROTOCOLS, toolkit, toolkitLayer } from "../src/mcp.js";

const event = (
  seq: number,
  name: string,
  cause?: number,
): Debug.DebugEvent => ({
  seq,
  time: seq,
  type: "write",
  name,
  id: `store-${seq}`,
  ...(cause === undefined ? {} : { cause }),
});

// A publication (1) whose handler writes twice (2, 3); the second write
// causes a further write (4). Event 5 belongs to an unrelated chain.
const events: ReadonlyArray<Debug.DebugEvent> = [
  event(1, "task.rename"),
  event(2, "task.title", 1),
  event(3, "task.dirty", 1),
  event(4, "board.summary", 3),
  event(5, "other.unrelated"),
];

const snapshot: Debug.Snapshot = {
  instances: [{ model: "app/task", key: { id: "1" }, leases: 2 }],
  stores: [
    { id: "s1", name: "app/task(1).outputs.title", value: "Write tests", derived: false },
    { id: "s2", name: "app/board.outputs.summary", value: 3, derived: true },
  ],
};

const stubHub = (overrides?: Partial<Parameters<typeof AppHub.of>[0]>) =>
  Layer.succeed(
    AppHub,
    AppHub.of({
      events: (sinceSeq) =>
        sinceSeq === undefined ? events : events.filter((recorded) => recorded.seq > sinceSeq),
      snapshot: Effect.succeed(snapshot),
      connected: () => true,
      ...overrides,
    }),
  );

/** Calls a tool the way the MCP server does: through the toolkit, so the
 * parameter and success schemas take part in the test. */
const call = <Name extends keyof typeof toolkit.tools>(
  name: Name,
  params: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const handlers = yield* toolkit;
    // eslint-disable-next-line revizo/no-type-assertion
    const stream = yield* handlers.handle(name, params as never);
    const results = yield* Stream.runCollect(stream);
    const last = results[results.length - 1];
    assert.isDefined(last);
    return last.result;
  });

const withHub = (hub: Layer.Layer<AppHub>) => toolkitLayer.pipe(Layer.provide(hub));

describe("@unitflow/devtools toolkit", () => {
  it.effect("list_instances reports the snapshot's live instances", () =>
    call("list_instances", {}).pipe(
      Effect.map((result) => {
        assert.deepStrictEqual(result, snapshot.instances);
      }),
      Effect.provide(withHub(stubHub())),
    ),
  );

  it.effect("get_stores filters by a substring of the store name", () =>
    call("get_stores", { filter: "board" }).pipe(
      Effect.map((result) => {
        assert.deepStrictEqual(
          (result as ReadonlyArray<{ readonly id: string }>).map((store) => store.id),
          ["s2"],
        );
      }),
      Effect.provide(withHub(stubHub())),
    ),
  );

  it.effect("get_stores surfaces the hub's error when no app is connected", () =>
    call("get_stores", {}).pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.instanceOf(error, HubError);
      }),
      Effect.provide(
        withHub(
          stubHub({ snapshot: Effect.fail(new HubError({ message: "No app connected." })) }),
        ),
      ),
    ),
  );

  it.effect("event_log applies since_seq, name filter and limit together", () =>
    Effect.gen(function* () {
      const since = yield* call("event_log", { since_seq: 3 });
      assert.deepStrictEqual(
        (since as ReadonlyArray<Debug.DebugEvent>).map((recorded) => recorded.seq),
        [4, 5],
      );

      const filtered = yield* call("event_log", { filter: "task" });
      assert.deepStrictEqual(
        (filtered as ReadonlyArray<Debug.DebugEvent>).map((recorded) => recorded.seq),
        [1, 2, 3],
      );

      // The limit keeps the NEWEST events, not the first ones scanned.
      const limited = yield* call("event_log", { limit: 2 });
      assert.deepStrictEqual(
        (limited as ReadonlyArray<Debug.DebugEvent>).map((recorded) => recorded.seq),
        [4, 5],
      );
    }).pipe(Effect.provide(withHub(stubHub()))),
  );

  it.effect("trace walks up to the root publication and down to descendants", () =>
    call("trace", { seq: 3 }).pipe(
      Effect.map((result) => {
        const { chain, descendants } = result as {
          readonly chain: ReadonlyArray<Debug.DebugEvent>;
          readonly descendants: ReadonlyArray<Debug.DebugEvent>;
        };
        assert.deepStrictEqual(
          chain.map((recorded) => recorded.seq),
          [1, 3],
        );
        assert.deepStrictEqual(
          descendants.map((recorded) => recorded.seq),
          [4],
        );
      }),
      Effect.provide(withHub(stubHub())),
    ),
  );

  it("negotiates every MCP revision Effect ships, newest first", () => {
    assert.deepStrictEqual(
      PROTOCOLS.map((protocol) => protocol.protocolVersion),
      ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"],
    );
  });
});
