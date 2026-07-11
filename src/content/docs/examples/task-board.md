---
title: Kanban Board
description: A Unitflow example with keyed task models, Model.list, nested Views, and direct model tests.
---

This example matches the shape of the `examples/ts/kanban-board` app: one
model per task, one parent model for the board, and React Views that render the
models' `ui`.

## Task Model

```ts
import * as Effect from "effect/Effect";
import { Event, Model, Store } from "@unitflow/core";

export type TaskStatus = "todo" | "doing" | "done";

export interface TaskKey {
  readonly id: string;
}

export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly assignee: string;
  readonly blocked: boolean;
}

const initialTask = (id: string): TaskState => ({
  id,
  title: "New task",
  status: "todo",
  assignee: "Unassigned",
  blocked: false,
});

export class TaskModel extends Model.Service<TaskModel>()(
  "examples/task-board/task",
)<TaskKey>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const state = Store.make<TaskState>(initialTask(id), {
        name: `task:${id}`,
      });

      const rename = yield* Event.input<string>().pipe(
        Event.handler((title) =>
          Store.update(state, (task) => ({
            ...task,
            title: title.trim() === "" ? task.title : title,
          })),
        ),
      );

      const move = yield* Event.input<TaskStatus>().pipe(
        Event.handler((status) =>
          Store.update(state, (task) => ({ ...task, status })),
        ),
      );

      const assign = yield* Event.input<string>().pipe(
        Event.handler((assignee) =>
          Store.update(state, (task) => ({
            ...task,
            assignee: assignee.trim() === "" ? "Unassigned" : assignee,
          })),
        ),
      );

      const toggleBlocked = yield* Event.input<void>().pipe(
        Event.handler(() =>
          Store.update(state, (task) => ({
            ...task,
            blocked: !task.blocked,
          })),
        ),
      );

      return {
        inputs: { rename, move, assign, toggleBlocked },
        outputs: { state },
        ui: { state, rename, move, assign, toggleBlocked },
      };
    }),
}) {}
```

## Board Model

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Store } from "@unitflow/core";
import { TaskModel } from "./task-model";

export class BoardModel extends Model.Service<BoardModel>()(
  "examples/task-board/board",
)({
  make: Effect.gen(function* () {
    const draft = Store.make("");
    const tasks = yield* Model.list(TaskModel);

    yield* tasks.push({ id: "task-1" });
    yield* tasks.push({ id: "task-2" });

    const taskStates = tasks.select((task) => task.outputs.state);
    const boardState = Store.combine([draft, taskStates], (draft, taskStates) => {
      const counts = {
        todo: taskStates.filter((task) => task.status === "todo").length,
        doing: taskStates.filter((task) => task.status === "doing").length,
        done: taskStates.filter((task) => task.status === "done").length,
      };

      return { draft, taskStates, counts };
    });

    let nextTaskId = 3;

    const create = yield* Event.make<void>().pipe(
      Event.handler(() =>
        Effect.gen(function* () {
          const title = (yield* Store.get(draft)).trim();
          if (title === "") return;

          const id = `task-${nextTaskId++}`;
          const task = yield* tasks.push({ id });
          yield* Event.emit(task.inputs.rename, title);
          yield* Store.set(draft, "");
        }),
      ),
    );

    const remove = yield* Event.make<string>().pipe(
      Event.handler((id) => tasks.remove({ id })),
    );

    const reopenFirstBlocked = yield* Event.make<void>().pipe(
      Event.handler(() =>
        Effect.gen(function* () {
          const current = yield* Store.get(taskStates);
          const blocked = current.find((task) => task.blocked);
          if (blocked === undefined) return;

          const task = yield* tasks.get({ id: blocked.id });
          if (Option.isSome(task)) {
            yield* Event.emit(task.value.inputs.move, "todo");
            yield* Event.emit(task.value.inputs.toggleBlocked);
          }
        }),
      ),
    );

    return {
      inputs: {},
      outputs: { taskStates },
      ui: {
        boardState,
        taskUnits: tasks.items,
        setDraft: Event.setter(draft),
        create,
        remove,
        reopenFirstBlocked,
      },
    };
  }),
}) {}
```

## Views

```tsx
import { View } from "@unitflow/react";
import { BoardModel } from "./board-model";
import { TaskModel, type TaskStatus } from "./task-model";

export const TaskCard = View.make(TaskModel, (task) => (
  <article>
    <input
      value={task.state.title}
      onChange={(event) => task.rename(event.currentTarget.value)}
    />

    <select
      value={task.state.status}
      onChange={(event) => task.move(event.currentTarget.value as TaskStatus)}
    >
      <option value="todo">Todo</option>
      <option value="doing">Doing</option>
      <option value="done">Done</option>
    </select>
  </article>
));

export const BoardView = View.make(
  BoardModel,
  ({ boardState, taskUnits, setDraft, create }) => (
    <section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <input
          value={boardState.draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="New task"
        />
      </form>

      {taskUnits.map((task) => (
        <TaskCard
          key={task.key.id}
          unit={task}
        />
      ))}
    </section>
  ),
);
```

The parent View receives child units and passes each one to `TaskCard`. The
child View still only sees the child model's `ui`.

## Test

```ts
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Event, Model, Registry, Store } from "@unitflow/core";
import { BoardModel } from "./board-model";
import { TaskModel } from "./task-model";

const testLayer = BoardModel.layer.pipe(
  Layer.provideMerge(TaskModel.layer),
  Layer.provideMerge(Registry.layer),
);

it.effect("creates a task from the draft", () =>
  Effect.gen(function* () {
    const board = yield* Model.get(BoardModel);

    yield* Registry.allSettled(
      Effect.gen(function* () {
        yield* Event.emit(board.ui.setDraft, "Write docs");
        yield* Event.emit(board.ui.create);
      }),
    );

    const tasks = yield* Store.get(board.outputs.taskStates);
    assert.strictEqual(tasks.at(-1)?.title, "Write docs");
  }).pipe(Effect.provide(testLayer)),
);
```
