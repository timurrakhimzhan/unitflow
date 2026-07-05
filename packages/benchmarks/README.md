# Unitflow Benchmarks

These are local, comparative microbenchmarks for Unitflow core state primitives
and a small set of popular state managers.

The scenarios follow the same broad shape as Reatom's public benchmarks:

- keep user computations intentionally cheap, so the numbers mostly show state
  manager overhead;
- update every library through the same logical scenario and assert equal
  results;
- rotate library order between iterations to reduce cross-test JIT bias;
- report median plus trimmed min/max rather than a single best run;
- optionally run with `node --expose-gc` and sample heap deltas.

The default suite covers:

- `write-read`: one writable state cell, updated and read back.
- `computed-diamond-pull`: a Reatom-style diamond graph, updated at the leaf and
  read at the root.
- `computed-diamond-push`: the same diamond graph with a live subscriber at the
  root.
- `fanout-1000`: one writable source with 1000 subscribers/listeners.

Run:

```sh
pnpm bench
```

For a faster smoke run:

```sh
pnpm --filter @unitflow/benchmarks bench:quick
```

Useful knobs:

- `BENCH_PROFILE=quick|default|stress`
- `BENCH_ITERATIONS=5000`
- `BENCH_WARMUP=200`
- `BENCH_FANOUT=1000`
- `BENCH_HEAP=1` to sample heap deltas; this is much slower because it forces
  GC before each measured operation.

Benchmarks are machine-sensitive. Compare libraries within one run on one
machine; do not compare absolute numbers across laptops or CI hosts.
