# Example: Kanban Board

One model owns one task. A parent board model owns a dynamic `Model.list` of
tasks and gives React child units to render.

```ts
export class TaskModel extends Model.Service<TaskModel>()("examples/task")<TaskKey>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const state = Store.make<TaskState>(initialTask(id));

      const rename = yield* Event.make<string>().pipe(
        Event.handler((title) =>
          Store.update(state, (task) => ({
            ...task,
            title: title.trim() === "" ? task.title : title,
          })),
        ),
      );

      return {
        inputs: { rename },
        outputs: { state },
        ui: { state, rename },
      };
    }),
}) {}
```

```ts
export class BoardModel extends Model.Service<BoardModel>()("examples/board")({
  make: () => Effect.gen(function* () {
    const draft = Store.make("");
    const tasks = yield* Model.list(TaskModel);
    const taskStates = tasks.select((task) => task.outputs.state);

    const create = yield* Event.make<void>().pipe(
      Event.handler(() =>
        Effect.gen(function* () {
          const title = (yield* Store.get(draft)).trim();
          if (title === "") return;

          const task = yield* tasks.push({ id: crypto.randomUUID() });
          yield* Event.emit(task.inputs.rename, title);
          yield* Store.set(draft, "");
        }),
      ),
    );

    return {
      inputs: {},
      outputs: { taskStates },
      ui: {
        boardState: Store.combine([draft, taskStates], (draft, taskStates) => ({
          draft,
          taskStates,
        })),
        taskUnits: tasks.items,
        setDraft: Event.setter(draft),
        create,
      },
    };
  }),
}) {}
```

```tsx
export const TaskCard = View.make(TaskModel, (task) => (
  <input
    value={task.state.title}
    onChange={(event) => task.rename(event.currentTarget.value)}
  />
));

export const BoardView = View.make(BoardModel, ({ boardState, taskUnits }) => (
  <section>
    {taskUnits.map((task) => (
      <TaskCard key={task.key.id} unit={task} />
    ))}
  </section>
));
```
