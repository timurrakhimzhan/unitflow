# Example: Counter

One model owns the counter state and events. The View renders `ui`.

```ts
const count = Store.make(0);
const step = Store.make(1);

const increment = yield* Event.make<void>().pipe(
  Event.handler(() =>
    Effect.gen(function* () {
      const amount = yield* Store.get(step);
      yield* Store.update(count, (value) => value + amount);
    }),
  ),
);

const counterState = Store.combine([count, step], (count, step) => ({
  count,
  step,
  doubled: count * 2,
  parity: count % 2 === 0 ? "even" : "odd",
}));

return {
  outputs: { count },
  ui: {
    counterState,
    setStep: Event.setter(step),
    increment,
  },
};
```

Runnable app: `examples/ts/counter`.
