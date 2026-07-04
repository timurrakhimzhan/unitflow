# Unitflow Examples

## Project Picker

```ts
export class ProjectPickerModel extends Model.Service<ProjectPickerModel>()(
  "features/project-picker",
)<ProjectPickerKey>()({
  make: () =>
    Effect.gen(function* () {
      const projects = yield* Model.get(ProjectsEntityModel);
      const open = Store.make(false);
      const selected = Event.make<ProjectPickerEvent>();

      const selectTarget = yield* Event.make<ProjectTarget>().pipe(
        Event.handler((target) =>
          Effect.gen(function* () {
            yield* Event.emit(projects.inputs.select, target);
            yield* Event.emit(selected, ProjectPickerEvent.Selected({ target }));
          }),
        ),
      );

      return {
        inputs: {},
        outputs: { selected },
        ui: {
          view: Store.combine([projects.outputs.projects, open], (projects, open) => ({
            projects,
            open,
          })),
          setOpen: Event.setter(open),
          selectTarget,
        },
      };
    }),
}) {}
```

## View

```tsx
export const ProjectPicker = View.make(ProjectPickerModel, (units) => {
  const view = units.view;
  return (
    <PickerMenu
      open={view.open}
      projects={view.projects}
      onOpenChange={units.setOpen}
      onSelect={units.selectTarget}
    />
  );
});
```

## Parent Composition

```ts
const picker = yield* Model.get(ProjectPickerModel, pickerKey);

yield* Registry.run(
  Event.stream(picker.outputs.selected).pipe(
    Stream.mapEffect((event) => handleSelection(event)),
  ),
);

return {
  inputs: {},
  outputs: {},
  ui: { picker },
};
```
