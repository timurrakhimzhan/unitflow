# Streams and Registry Runs

Use `Event.handler` for direct reactions. Use `Registry.run` when the
connection needs stream operators.

```ts
yield* Registry.run(
  Event.stream(textChanged).pipe(
    Stream.map((text) => text.trim()),
    Stream.filter((text) => text.length >= 2),
    Stream.debounce("300 millis"),
    Stream.mapEffect((query) => Event.emit(searchRequested, query)),
  ),
);
```

`Registry.run` forks the stream into the current owner scope. Inside a model,
that is the model instance. The stream error channel must be `never`; catch
failures inside the pipeline and write them to state or emit events.

Do not use `Stream.mapEffect(..., { concurrency })` to make event handlers
concurrent. Use `Event.handler(fn, { concurrency: "unbounded" })`.
