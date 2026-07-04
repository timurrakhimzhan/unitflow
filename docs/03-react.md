# React Binding

React is a binding layer, not the owner of model logic.

```tsx
export const ProjectPicker = View.make(ProjectPickerModel, (units) => {
  const view = units.view;

  return (
    <Menu
      open={view.open}
      onOpenChange={units.setOpen}
      onSelect={(target) => units.selectTarget(target)}
    />
  );
});
```

Views receive only `ui` ports:

- Store sources become current values.
- Event sinks become callbacks.
- Nested unit ports stay as ports and are passed to child Views.

## Resolving Units

Resolve by key:

```tsx
<ProjectPicker unitKey={{ scope: "ifc" }} />
```

Or render ports a parent model already holds:

```tsx
<ProjectPicker unit={units.projectPicker} />
```

## View Rules

- Do not read `inputs` or `outputs` in JSX.
- Do not derive business state in JSX.
- Do not use `useState` / `useEffect` in model-backed Views.
- Publish a ready `view` store if rendering needs branches or computed values.

Imperative canvas/3D leaves may own refs and local lifecycle, but should report
domain facts back through model events.
