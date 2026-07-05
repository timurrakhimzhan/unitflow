import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { Event, Registry, Store, UnitflowRuntime } from "@unitflow/core";

const profileName = process.env.BENCH_PROFILE ?? "default";

const profiles = {
  quick: {
    iterations: 1_000,
    warmup: 100,
    fanout: 250,
  },
  default: {
    iterations: 8_000,
    warmup: 500,
    fanout: 1_000,
  },
  stress: {
    iterations: 40_000,
    warmup: 1_000,
    fanout: 5_000,
  },
};

const profile = {
  ...(profiles[profileName] ?? profiles.default),
  iterations: Number(process.env.BENCH_ITERATIONS ?? profiles[profileName]?.iterations ?? 8_000),
  warmup: Number(process.env.BENCH_WARMUP ?? profiles[profileName]?.warmup ?? 500),
  fanout: Number(process.env.BENCH_FANOUT ?? profiles[profileName]?.fanout ?? 1_000),
};

const collectHeap = process.env.BENCH_HEAP === "1";

const libraries = [
  unitflowAdapter(),
  unitflowRuntimeAdapter(),
  unitflowChangedAdapter(),
  reatomAdapter(),
  effectorAdapter(),
  nanostoresAdapter(),
  jotaiAdapter(),
  zustandAdapter(),
  preactSignalsAdapter(),
  mobxAdapter(),
];

const scenarios = [
  {
    name: "write-read",
    iterations: profile.iterations,
    warmup: profile.warmup,
    load: ({ adapter }) => adapter.writeRead?.(),
  },
  {
    name: "computed-diamond-pull",
    iterations: profile.iterations,
    warmup: profile.warmup,
    load: ({ adapter }) => adapter.computedDiamondPull?.(),
  },
  {
    name: "computed-diamond-push",
    iterations: Math.max(100, Math.floor(profile.iterations / 4)),
    warmup: Math.max(20, Math.floor(profile.warmup / 4)),
    load: ({ adapter }) => adapter.computedDiamondPush?.(),
  },
  {
    name: `fanout-${profile.fanout}`,
    iterations: Math.max(100, Math.floor(profile.iterations / 8)),
    warmup: Math.max(20, Math.floor(profile.warmup / 8)),
    load: ({ adapter }) => adapter.fanout?.(profile.fanout),
  },
  {
    name: "unitflow-runtime-store",
    iterations: Math.max(100, Math.floor(profile.iterations / 4)),
    warmup: Math.max(20, Math.floor(profile.warmup / 4)),
    load: ({ adapter }) => adapter.runtimeStore?.(),
  },
];

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

function rotate(items, offset) {
  const index = offset % items.length;
  return items.slice(index).concat(items.slice(0, index));
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index];
}

function formatNumber(value, fractionDigits = 4) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

async function timeCall(fn, iteration) {
  const start = performance.now();
  const value = fn(iteration);
  if (value && typeof value.then === "function") await value;
  return performance.now() - start;
}

async function cleanupBench(bench) {
  if (bench?.cleanup === undefined) return;
  const value = bench.cleanup();
  if (value && typeof value.then === "function") await value;
}

async function loadBench(factory) {
  const bench = await factory();
  if (bench === undefined) return undefined;
  if (bench.update === undefined || bench.read === undefined) {
    throw new Error("Benchmark factory must return { update, read }.");
  }
  return bench;
}

function assertSameResult(scenarioName, benches, iteration) {
  const values = benches.map((bench) => [bench.name, bench.read()]);
  const first = values[0]?.[1];
  const mismatches = values.filter(([, value]) => !Object.is(value, first));
  if (mismatches.length === 0) return;
  throw new Error(
    `${scenarioName} result mismatch at iteration ${iteration}: ${JSON.stringify(
      Object.fromEntries(values),
    )}`,
  );
}

async function runScenario(scenario) {
  const benches = [];

  for (const adapter of libraries) {
    const factory = scenario.load({ adapter });
    if (factory === undefined) continue;
    const bench = await loadBench(factory);
    if (bench !== undefined) benches.push({ ...bench, name: adapter.name });
  }

  if (benches.length === 0) {
    console.log(`\n${scenario.name}: no compatible libraries`);
    return;
  }

  try {
    for (let i = 0; i < scenario.warmup; i++) {
      for (const bench of rotate(benches, i)) {
        await bench.update(-(i + 1));
      }
    }

    assertSameResult(scenario.name, benches, -1);
    await sleep();

    for (let i = 1; i <= scenario.iterations; i++) {
      for (const bench of rotate(benches, i)) {
        if (collectHeap && globalThis.gc !== undefined) {
          globalThis.gc();
          globalThis.gc();
        }
        const beforeHeap = collectHeap ? process.memoryUsage().heapUsed : 0;
        bench.logs.push(await timeCall(bench.update, i % 2));
        if (collectHeap) bench.heapLogs.push(process.memoryUsage().heapUsed - beforeHeap);
      }

      if (i % 100 === 0) await sleep();
    }

    assertSameResult(scenario.name, benches, scenario.iterations);
    printScenario(scenario, benches);
  } finally {
    await Promise.all(benches.map(cleanupBench));
  }
}

function printScenario(scenario, benches) {
  const fastest = Math.min(...benches.map((bench) => median(bench.logs)));
  const rows = {};

  for (const bench of benches.sort((a, b) => median(a.logs) - median(b.logs))) {
    const med = median(bench.logs);
    const row = {
      "rel %": formatNumber((fastest / med) * 100, 1),
      "med ms": formatNumber(med, 5),
      "p05 ms": formatNumber(percentile(bench.logs, 0.05), 5),
      "p95 ms": formatNumber(percentile(bench.logs, 0.95), 5),
      result: bench.read(),
    };
    if (collectHeap) row["heap med"] = formatNumber(median(bench.heapLogs), 0);
    rows[bench.name] = row;
  }

  console.log(`\n${scenario.name}`);
  console.table(rows);
}

function makeBench({ update, read, cleanup }) {
  return {
    update,
    read,
    cleanup,
    logs: [],
    heapLogs: [],
  };
}

function unitflowRuntime() {
  return ManagedRuntime.make(Registry.layer);
}

function unitflowDispose(runtime) {
  return runtime.dispose();
}

function unitflowAdapter() {
  return {
    name: "unitflow",
    writeRead: () => async () => {
      const runtime = unitflowRuntime();
      const count = Store.make(0);
      runtime.runSync(Store.get(count));
      return makeBench({
        update: (value) => runtime.runSync(Store.set(count, value)),
        read: () => runtime.runSync(Store.get(count)),
        cleanup: () => unitflowDispose(runtime),
      });
    },
    computedDiamondPull: () => async () => {
      const runtime = unitflowRuntime();
      const entry = Store.make(0);
      const a = Store.combine([entry], (entry) => entry);
      const b = Store.combine([a], (a) => a + 1);
      const c = Store.combine([a], (a) => a + 1);
      const d = Store.combine([b, c], (b, c) => b + c);
      const e = Store.combine([d], (d) => d + 1);
      const f = Store.combine([d, e], (d, e) => d + e);
      const g = Store.combine([d, e], (d, e) => d + e);
      const h = Store.combine([f, g], (f, g) => f + g);
      runtime.runSync(Store.get(h));
      return makeBench({
        update: (value) => {
          runtime.runSync(Store.set(entry, value));
          return runtime.runSync(Store.get(h));
        },
        read: () => runtime.runSync(Store.get(h)),
        cleanup: () => unitflowDispose(runtime),
      });
    },
    computedDiamondPush: () => async () => {
      const runtime = unitflowRuntime();
      const entry = Store.make(0);
      const a = Store.combine([entry], (entry) => entry);
      const b = Store.combine([a], (a) => a + 1);
      const c = Store.combine([a], (a) => a + 1);
      const d = Store.combine([b, c], (b, c) => b + c);
      const e = Store.combine([d], (d) => d + 1);
      const f = Store.combine([d, e], (d, e) => d + e);
      const g = Store.combine([d, e], (d, e) => d + e);
      const h = Store.combine([f, g], (f, g) => f + g);
      let latest = runtime.runSync(Store.get(h));
      let expected = latest;
      let resolveExpected;
      const fiber = runtime.runFork(
        Store.stream(h).pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              latest = value;
              if (value === expected && resolveExpected !== undefined) {
                const resolve = resolveExpected;
                resolveExpected = undefined;
                resolve();
              }
            }),
          ),
        ),
      );
      await sleep();
      return makeBench({
        update: (value) => {
          expected = 8 * value + 10;
          const settled =
            latest === expected
              ? Promise.resolve()
              : new Promise((resolve) => {
                  resolveExpected = resolve;
                });
          runtime.runSync(Store.set(entry, value));
          return settled;
        },
        read: () => latest,
        cleanup: async () => {
          runtime.runFork(Fiber.interrupt(fiber));
          await unitflowDispose(runtime);
        },
      });
    },
    fanout: (count) => async () => {
      const runtime = unitflowRuntime();
      const source = Store.make(0);
      let sum = 0;
      let expected = 0;
      let pending = 0;
      let resolvePending;
      const fibers = Array.from({ length: count }, () =>
        runtime.runFork(
          Store.stream(source).pipe(
            Stream.runForEach((value) =>
              Effect.sync(() => {
                sum += value;
                if (pending > 0 && value === expected) {
                  pending -= 1;
                  if (pending === 0 && resolvePending !== undefined) {
                    const resolve = resolvePending;
                    resolvePending = undefined;
                    resolve();
                  }
                }
              }),
            ),
          ),
        ),
      );
      await sleep();
      return makeBench({
        update: (value) => {
          expected = value;
          pending = count;
          const settled = new Promise((resolve) => {
            resolvePending = resolve;
          });
          runtime.runSync(Store.set(source, value));
          return settled;
        },
        read: () => sum,
        cleanup: async () => {
          for (const fiber of fibers) runtime.runFork(Fiber.interrupt(fiber));
          await unitflowDispose(runtime);
        },
      });
    },
    runtimeStore: () => async () => {
      const runtime = UnitflowRuntime.make(Layer.empty);
      const source = Store.make(0);
      let seen = 0;
      let expected = seen;
      let resolveExpected;
      const unsubscribe = runtime.subscribeStore(source, () => {
        seen = runtime.getStore(source);
        if (seen === expected && resolveExpected !== undefined) {
          const resolve = resolveExpected;
          resolveExpected = undefined;
          resolve();
        }
      });
      await sleep();
      return makeBench({
        update: (value) => {
          expected = value;
          const settled =
            seen === expected
              ? Promise.resolve()
              : new Promise((resolve) => {
                  resolveExpected = resolve;
                });
          runtime.runtime.runSync(Store.set(source, value));
          return settled;
        },
        read: () => seen,
        cleanup: async () => {
          unsubscribe();
          await runtime.dispose();
        },
      });
    },
  };
}

/**
 * The recommended UI path: `UnitflowRuntime` shares one stream fiber per store
 * across all listeners, where the raw `Store.stream` adapter pays one fiber
 * per subscriber.
 */
function unitflowRuntimeAdapter() {
  return {
    name: "unitflow (runtime)",
    computedDiamondPush: () => async () => {
      const runtime = UnitflowRuntime.make(Layer.empty);
      const entry = Store.make(0);
      const a = Store.combine([entry], (entry) => entry);
      const b = Store.combine([a], (a) => a + 1);
      const c = Store.combine([a], (a) => a + 1);
      const d = Store.combine([b, c], (b, c) => b + c);
      const e = Store.combine([d], (d) => d + 1);
      const f = Store.combine([d, e], (d, e) => d + e);
      const g = Store.combine([d, e], (d, e) => d + e);
      const h = Store.combine([f, g], (f, g) => f + g);
      let latest = runtime.getStore(h);
      let expected = latest;
      let resolveExpected;
      const unsubscribe = runtime.subscribeStore(h, () => {
        latest = runtime.getStore(h);
        if (latest === expected && resolveExpected !== undefined) {
          const resolve = resolveExpected;
          resolveExpected = undefined;
          resolve();
        }
      });
      await sleep();
      return makeBench({
        update: (value) => {
          expected = 8 * value + 10;
          const settled =
            latest === expected
              ? Promise.resolve()
              : new Promise((resolve) => {
                  resolveExpected = resolve;
                });
          runtime.runtime.runSync(Store.set(entry, value));
          return settled;
        },
        read: () => latest,
        cleanup: async () => {
          unsubscribe();
          await runtime.dispose();
        },
      });
    },
    fanout: (count) => async () => {
      const runtime = UnitflowRuntime.make(Layer.empty);
      const source = Store.make(0);
      let sum = 0;
      let expected = 0;
      let pending = 0;
      let resolvePending;
      const unsubs = Array.from({ length: count }, () =>
        runtime.subscribeStore(source, () => {
          const value = runtime.getStore(source);
          sum += value;
          if (pending > 0 && value === expected) {
            pending -= 1;
            if (pending === 0 && resolvePending !== undefined) {
              const resolve = resolvePending;
              resolvePending = undefined;
              resolve();
            }
          }
        }),
      );
      await sleep();
      return makeBench({
        update: (value) => {
          expected = value;
          pending = count;
          const settled = new Promise((resolve) => {
            resolvePending = resolve;
          });
          runtime.runtime.runSync(Store.set(source, value));
          return settled;
        },
        read: () => sum,
        cleanup: async () => {
          for (const unsub of unsubs) unsub();
          await runtime.dispose();
        },
      });
    },
  };
}

/** The declarative model-logic shape: `Store.changed` piped into
 * `Event.handler`, one subscription per handler. */
function unitflowChangedAdapter() {
  return {
    name: "unitflow (changed)",
    fanout: (count) => async () => {
      const runtime = unitflowRuntime();
      const source = Store.make(0);
      let sum = 0;
      let expected = 0;
      let pending = 0;
      let resolvePending;
      await runtime.runPromise(
        Effect.gen(function* () {
          for (let i = 0; i < count; i++) {
            yield* Store.changed(source).pipe(
              Event.handler((value) =>
                Effect.sync(() => {
                  sum += value;
                  if (pending > 0 && value === expected) {
                    pending -= 1;
                    if (pending === 0 && resolvePending !== undefined) {
                      const resolve = resolvePending;
                      resolvePending = undefined;
                      resolve();
                    }
                  }
                }),
              ),
            );
          }
        }),
      );
      await sleep();
      return makeBench({
        update: (value) => {
          expected = value;
          pending = count;
          const settled = new Promise((resolve) => {
            resolvePending = resolve;
          });
          runtime.runSync(Store.set(source, value));
          return settled;
        },
        read: () => sum,
        cleanup: () => unitflowDispose(runtime),
      });
    },
  };
}

function reatomAdapter() {
  return {
    name: "reatom",
    writeRead: () => async () => {
      const { atom } = await import("@reatom/core");
      const count = atom(0, "count");
      return makeBench({
        update: (value) => count.set(value),
        read: () => count(),
      });
    },
    computedDiamondPull: () => async () => {
      const { atom, computed } = await import("@reatom/core");
      const entry = atom(0, "entry");
      const a = computed(() => entry(), "a");
      const b = computed(() => a() + 1, "b");
      const c = computed(() => a() + 1, "c");
      const d = computed(() => b() + c(), "d");
      const e = computed(() => d() + 1, "e");
      const f = computed(() => d() + e(), "f");
      const g = computed(() => d() + e(), "g");
      const h = computed(() => f() + g(), "h");
      return makeBench({
        update: (value) => {
          entry.set(value);
          return h();
        },
        read: () => h(),
      });
    },
    computedDiamondPush: () => async () => {
      const { atom, computed, context, wrap, notify, clearStack } = await import("@reatom/core");
      clearStack?.();
      const entry = atom(0, "entry");
      const a = computed(() => entry(), "a");
      const b = computed(() => a() + 1, "b");
      const c = computed(() => a() + 1, "c");
      const d = computed(() => b() + c(), "d");
      const e = computed(() => d() + 1, "e");
      const f = computed(() => d() + e(), "f");
      const g = computed(() => d() + e(), "g");
      const h = computed(() => f() + g(), "h");
      let latest = 0;
      let unsubscribe;
      const set = context.start(() => {
        latest = h();
        unsubscribe = h.subscribe((value) => (latest = value));
        return wrap((value) => {
          entry.set(value);
          notify();
        });
      });
      return makeBench({
        update: set,
        read: () => latest,
        cleanup: () => unsubscribe?.(),
      });
    },
  };
}

function effectorAdapter() {
  return {
    name: "effector",
    writeRead: () => async () => {
      const { createEvent, createStore } = await import("effector");
      const set = createEvent();
      const count = createStore(0).on(set, (_, value) => value);
      return makeBench({
        update: (value) => set(value),
        read: () => count.getState(),
      });
    },
    computedDiamondPull: () => async () => {
      const { createEvent, createStore, combine } = await import("effector");
      const set = createEvent();
      const entry = createStore(0).on(set, (_, value) => value);
      const a = entry.map((entry) => entry);
      const b = a.map((a) => a + 1);
      const c = a.map((a) => a + 1);
      const d = combine(b, c, (b, c) => b + c);
      const e = d.map((d) => d + 1);
      const f = combine(d, e, (d, e) => d + e);
      const g = combine(d, e, (d, e) => d + e);
      const h = combine(f, g, (f, g) => f + g);
      return makeBench({
        update: (value) => {
          set(value);
          return h.getState();
        },
        read: () => h.getState(),
      });
    },
    computedDiamondPush: () => async () => {
      const { createEvent, createStore, combine } = await import("effector");
      const set = createEvent();
      const entry = createStore(0).on(set, (_, value) => value);
      const a = entry.map((entry) => entry);
      const b = a.map((a) => a + 1);
      const c = a.map((a) => a + 1);
      const d = combine(b, c, (b, c) => b + c);
      const e = d.map((d) => d + 1);
      const f = combine(d, e, (d, e) => d + e);
      const g = combine(d, e, (d, e) => d + e);
      const h = combine(f, g, (f, g) => f + g);
      let latest = h.getState();
      const unsubscribe = h.watch((value) => (latest = value));
      return makeBench({
        update: (value) => set(value),
        read: () => latest,
        cleanup: unsubscribe,
      });
    },
    fanout: (count) => async () => {
      const { createEvent, createStore } = await import("effector");
      const set = createEvent();
      const source = createStore(0).on(set, (_, value) => value);
      let sum = 0;
      const unsubs = Array.from({ length: count }, () => source.watch((value) => (sum += value)));
      return makeBench({
        update: (value) => set(value),
        read: () => sum,
        cleanup: () => unsubs.forEach((unsub) => unsub()),
      });
    },
  };
}

function nanostoresAdapter() {
  return {
    name: "nanostores",
    writeRead: () => async () => {
      const { atom } = await import("nanostores");
      const count = atom(0);
      return makeBench({
        update: (value) => count.set(value),
        read: () => count.get(),
      });
    },
    computedDiamondPull: () => async () => {
      const { atom, computed } = await import("nanostores");
      const entry = atom(0);
      const a = computed(entry, (entry) => entry);
      const b = computed(a, (a) => a + 1);
      const c = computed(a, (a) => a + 1);
      const d = computed([b, c], (b, c) => b + c);
      const e = computed(d, (d) => d + 1);
      const f = computed([d, e], (d, e) => d + e);
      const g = computed([d, e], (d, e) => d + e);
      const h = computed([f, g], (f, g) => f + g);
      return makeBench({
        update: (value) => {
          entry.set(value);
          return h.get();
        },
        read: () => h.get(),
      });
    },
    computedDiamondPush: () => async () => {
      const { atom, computed } = await import("nanostores");
      const entry = atom(0);
      const a = computed(entry, (entry) => entry);
      const b = computed(a, (a) => a + 1);
      const c = computed(a, (a) => a + 1);
      const d = computed([b, c], (b, c) => b + c);
      const e = computed(d, (d) => d + 1);
      const f = computed([d, e], (d, e) => d + e);
      const g = computed([d, e], (d, e) => d + e);
      const h = computed([f, g], (f, g) => f + g);
      let latest = h.get();
      const unsubscribe = h.subscribe((value) => (latest = value));
      return makeBench({
        update: (value) => entry.set(value),
        read: () => latest,
        cleanup: unsubscribe,
      });
    },
    fanout: (count) => async () => {
      const { atom } = await import("nanostores");
      const source = atom(0);
      let sum = 0;
      const unsubs = Array.from({ length: count }, () =>
        source.subscribe((value) => (sum += value)),
      );
      return makeBench({
        update: (value) => source.set(value),
        read: () => sum,
        cleanup: () => unsubs.forEach((unsub) => unsub()),
      });
    },
  };
}

function jotaiAdapter() {
  return {
    name: "jotai",
    writeRead: () => async () => {
      const { atom, createStore } = await import("jotai/vanilla");
      const store = createStore();
      const count = atom(0);
      return makeBench({
        update: (value) => store.set(count, value),
        read: () => store.get(count),
      });
    },
    computedDiamondPull: () => async () => {
      const { atom, createStore } = await import("jotai/vanilla");
      const store = createStore();
      const entry = atom(0);
      const a = atom((get) => get(entry));
      const b = atom((get) => get(a) + 1);
      const c = atom((get) => get(a) + 1);
      const d = atom((get) => get(b) + get(c));
      const e = atom((get) => get(d) + 1);
      const f = atom((get) => get(d) + get(e));
      const g = atom((get) => get(d) + get(e));
      const h = atom((get) => get(f) + get(g));
      return makeBench({
        update: (value) => {
          store.set(entry, value);
          return store.get(h);
        },
        read: () => store.get(h),
      });
    },
    computedDiamondPush: () => async () => {
      const { atom, createStore } = await import("jotai/vanilla");
      const store = createStore();
      const entry = atom(0);
      const a = atom((get) => get(entry));
      const b = atom((get) => get(a) + 1);
      const c = atom((get) => get(a) + 1);
      const d = atom((get) => get(b) + get(c));
      const e = atom((get) => get(d) + 1);
      const f = atom((get) => get(d) + get(e));
      const g = atom((get) => get(d) + get(e));
      const h = atom((get) => get(f) + get(g));
      let latest = store.get(h);
      const unsubscribe = store.sub(h, () => (latest = store.get(h)));
      return makeBench({
        update: (value) => store.set(entry, value),
        read: () => latest,
        cleanup: unsubscribe,
      });
    },
    fanout: (count) => async () => {
      const { atom, createStore } = await import("jotai/vanilla");
      const store = createStore();
      const source = atom(0);
      let sum = 0;
      const unsubs = Array.from({ length: count }, () =>
        store.sub(source, () => {
          sum += store.get(source);
        }),
      );
      return makeBench({
        update: (value) => store.set(source, value),
        read: () => sum,
        cleanup: () => unsubs.forEach((unsub) => unsub()),
      });
    },
  };
}

function zustandAdapter() {
  return {
    name: "zustand",
    writeRead: () => async () => {
      const { createStore } = await import("zustand/vanilla");
      const store = createStore(() => ({ value: 0 }));
      return makeBench({
        update: (value) => store.setState({ value }),
        read: () => store.getState().value,
      });
    },
    fanout: (count) => async () => {
      const { createStore } = await import("zustand/vanilla");
      const store = createStore(() => ({ value: 0 }));
      let sum = 0;
      const unsubs = Array.from({ length: count }, () =>
        store.subscribe((state) => {
          sum += state.value;
        }),
      );
      return makeBench({
        update: (value) => store.setState({ value }),
        read: () => sum,
        cleanup: () => unsubs.forEach((unsub) => unsub()),
      });
    },
  };
}

function preactSignalsAdapter() {
  return {
    name: "preact-signals",
    writeRead: () => async () => {
      const { signal } = await import("@preact/signals-core");
      const count = signal(0);
      return makeBench({
        update: (value) => (count.value = value),
        read: () => count.value,
      });
    },
    computedDiamondPull: () => async () => {
      const { signal, computed } = await import("@preact/signals-core");
      const entry = signal(0);
      const a = computed(() => entry.value);
      const b = computed(() => a.value + 1);
      const c = computed(() => a.value + 1);
      const d = computed(() => b.value + c.value);
      const e = computed(() => d.value + 1);
      const f = computed(() => d.value + e.value);
      const g = computed(() => d.value + e.value);
      const h = computed(() => f.value + g.value);
      return makeBench({
        update: (value) => {
          entry.value = value;
          return h.value;
        },
        read: () => h.value,
      });
    },
    computedDiamondPush: () => async () => {
      const { signal, computed, effect } = await import("@preact/signals-core");
      const entry = signal(0);
      const a = computed(() => entry.value);
      const b = computed(() => a.value + 1);
      const c = computed(() => a.value + 1);
      const d = computed(() => b.value + c.value);
      const e = computed(() => d.value + 1);
      const f = computed(() => d.value + e.value);
      const g = computed(() => d.value + e.value);
      const h = computed(() => f.value + g.value);
      let latest = h.value;
      const dispose = effect(() => {
        latest = h.value;
      });
      return makeBench({
        update: (value) => (entry.value = value),
        read: () => latest,
        cleanup: dispose,
      });
    },
    fanout: (count) => async () => {
      const { signal, effect } = await import("@preact/signals-core");
      const source = signal(0);
      let sum = 0;
      const disposers = Array.from({ length: count }, () =>
        effect(() => {
          sum += source.value;
        }),
      );
      return makeBench({
        update: (value) => (source.value = value),
        read: () => sum,
        cleanup: () => disposers.forEach((dispose) => dispose()),
      });
    },
  };
}

function mobxAdapter() {
  return {
    name: "mobx",
    writeRead: () => async () => {
      const { observable, configure } = await import("mobx");
      configure({ enforceActions: "never" });
      const count = observable.box(0);
      return makeBench({
        update: (value) => count.set(value),
        read: () => count.get(),
      });
    },
    computedDiamondPull: () => async () => {
      const { makeAutoObservable, configure } = await import("mobx");
      configure({ enforceActions: "never" });
      const store = makeAutoObservable({
        entry: 0,
        get a() {
          return this.entry;
        },
        get b() {
          return this.a + 1;
        },
        get c() {
          return this.a + 1;
        },
        get d() {
          return this.b + this.c;
        },
        get e() {
          return this.d + 1;
        },
        get f() {
          return this.d + this.e;
        },
        get g() {
          return this.d + this.e;
        },
        get h() {
          return this.f + this.g;
        },
      });
      return makeBench({
        update: (value) => {
          store.entry = value;
          return store.h;
        },
        read: () => store.h,
      });
    },
    computedDiamondPush: () => async () => {
      const { makeAutoObservable, autorun, configure } = await import("mobx");
      configure({ enforceActions: "never" });
      const store = makeAutoObservable({
        entry: 0,
        get a() {
          return this.entry;
        },
        get b() {
          return this.a + 1;
        },
        get c() {
          return this.a + 1;
        },
        get d() {
          return this.b + this.c;
        },
        get e() {
          return this.d + 1;
        },
        get f() {
          return this.d + this.e;
        },
        get g() {
          return this.d + this.e;
        },
        get h() {
          return this.f + this.g;
        },
      });
      let latest = store.h;
      const dispose = autorun(() => {
        latest = store.h;
      });
      return makeBench({
        update: (value) => (store.entry = value),
        read: () => latest,
        cleanup: dispose,
      });
    },
    fanout: (count) => async () => {
      const { observable, autorun, configure } = await import("mobx");
      configure({ enforceActions: "never" });
      const source = observable.box(0);
      let sum = 0;
      const disposers = Array.from({ length: count }, () =>
        autorun(() => {
          sum += source.get();
        }),
      );
      return makeBench({
        update: (value) => source.set(value),
        read: () => sum,
        cleanup: () => disposers.forEach((dispose) => dispose()),
      });
    },
  };
}

async function main() {
  console.log("Unitflow benchmark suite");
  console.log(`Node ${process.version}`);
  console.log(cpus()[0]?.model ?? "unknown cpu");
  console.log(`profile=${profileName}, iterations=${profile.iterations}, warmup=${profile.warmup}`);
  console.log(
    `heap=${collectHeap ? "on" : "off"}, gc=${globalThis.gc === undefined ? "off" : "on"}`,
  );

  for (const scenario of scenarios) {
    await runScenario(scenario);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
