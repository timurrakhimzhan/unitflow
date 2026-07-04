---
title: Project Picker
description: A compact Unitflow model example for selected project events.
---

```ts
type ProjectPickerEvent = Data.TaggedEnum<{
  readonly ExistingProjectSelected: { readonly id: ProjectId };
  readonly NewProjectSelected: { readonly name: string };
}>;

export class ProjectPickerModel extends Model.Service<ProjectPickerModel>()(
  "features/project-picker",
)<ProjectPickerKey>()({
  make: (key) =>
    Effect.gen(function* () {
      const projects = yield* Model.get(ProjectsEntityModel);

      const open = Store.make(false);
      const target = Store.make<ProjectTarget>({ _tag: "ActiveProject" });
      const selected = Event.make<ProjectPickerEvent>();

      const view = Store.combine(
        [projects.outputs.projects, projects.outputs.currentProject, open, target],
        (projects, currentProject, open, target) => ({
          projects,
          currentProject,
          open,
          target,
        }),
      );

      const setOpen = Event.setter(open);

      const selectTarget = yield* Event.make<ProjectTarget>().pipe(
        Event.handler((next) =>
          Effect.gen(function* () {
            yield* Store.set(target, next);
            yield* Event.emit(setOpen, false);
            yield* Event.emit(
              selected,
              next._tag === "ExistingProject"
                ? ProjectPickerEvent.ExistingProjectSelected({ id: next.id })
                : ProjectPickerEvent.NewProjectSelected({ name: next.name }),
            );
          }),
        ),
      );

      return {
        inputs: {},
        outputs: { selected },
        ui: { view, setOpen, selectTarget },
      };
    }),
}) {}
```

The View binds `ui`. Parent models stream `outputs.selected`.
