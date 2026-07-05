# React Binding

React binds model `ui`; it does not own model logic.

```tsx
const runtime = UnitflowRuntime.make(AppModel.layer);

createRoot(root).render(
  <Unitflow runtime={runtime} rootModel={AppModel}>
    {(app) => <AppView unit={app} />}
  </Unitflow>,
);
```

`Unitflow` provides the runtime and leases the root model (`building` /
`failed` render its construction states). Views never resolve models: the
root unit comes from `Unitflow`, every other unit from its parent model's
`ui` — JSX cannot summon an instance.

Create Views with `View.make`; every View takes exactly one wiring prop,
`unit`.

```tsx
export const CounterView = View.make(CounterModel, ({ count, increment }) => (
  <button type="button" onClick={() => increment()}>
    {count}
  </button>
));

<TaskView unit={task} />
```

Do not read `inputs` or `outputs` in JSX. Publish a domain-named store if the
UI needs derived state.
