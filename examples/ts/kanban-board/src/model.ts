import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Store } from "@unitflow/react";

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

const seededTasks: Record<string, TaskState> = {
  "task-1": {
    id: "task-1",
    title: "Sketch model ports",
    status: "todo",
    assignee: "Mira",
    blocked: false,
  },
  "task-2": {
    id: "task-2",
    title: "Wire resource states",
    status: "doing",
    assignee: "Noah",
    blocked: true,
  },
  "task-3": {
    id: "task-3",
    title: "Publish docs examples",
    status: "done",
    assignee: "Ira",
    blocked: false,
  },
};

const initialTask = (id: string): TaskState =>
  seededTasks[id] ?? {
    id,
    title: "New task",
    status: "todo",
    assignee: "Unassigned",
    blocked: false,
  };

export class TaskModel extends Model.Service<TaskModel>()(
  "@unitflow/example/kanban/task",
)<TaskKey>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const state = Store.make<TaskState>(initialTask(id), { name: `task:${id}` });

      const rename = yield* Event.make<string>({ name: `task:${id}.rename` }).pipe(
        Event.handler((title) =>
          Store.update(state, (task) => ({
            ...task,
            title: title.trim() === "" ? task.title : title,
          })),
        ),
      );

      const move = yield* Event.make<TaskStatus>({ name: `task:${id}.move` }).pipe(
        Event.handler((status) => Store.update(state, (task) => ({ ...task, status }))),
      );

      const assign = yield* Event.make<string>({ name: `task:${id}.assign` }).pipe(
        Event.handler((assignee) =>
          Store.update(state, (task) => ({
            ...task,
            assignee: assignee.trim() === "" ? "Unassigned" : assignee,
          })),
        ),
      );

      const toggleBlocked = yield* Event.make<void>({ name: `task:${id}.toggleBlocked` }).pipe(
        Event.handler(() => Store.update(state, (task) => ({ ...task, blocked: !task.blocked }))),
      );

      return {
        inputs: { rename, move, assign, toggleBlocked },
        outputs: { state },
        ui: { state, rename, move, assign, toggleBlocked },
      };
    }),
}) {}

export class BoardModel extends Model.Service<BoardModel>()(
  "@unitflow/example/kanban/board",
)({
  make: () =>
    Effect.gen(function* () {
      const draft = Store.make("", { name: "draft" });
      const tasks = yield* Model.list(TaskModel);

      yield* tasks.push({ id: "task-1" });
      yield* tasks.push({ id: "task-2" });
      yield* tasks.push({ id: "task-3" });

      const taskStates = tasks.select((task) => task.outputs.state);
      const view = Store.combine([draft, taskStates], (draft, taskStates) => {
        const counts = {
          todo: taskStates.filter((task) => task.status === "todo").length,
          doing: taskStates.filter((task) => task.status === "doing").length,
          done: taskStates.filter((task) => task.status === "done").length,
        };

        return { draft, taskStates, counts };
      });

      let nextTaskId = 4;

      const create = yield* Event.make<void>({ name: "createTask" }).pipe(
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

      const remove = yield* Event.make<string>({ name: "removeTask" }).pipe(
        Event.handler((id) => tasks.remove({ id })),
      );

      const clearDone = yield* Event.make<void>({ name: "clearDone" }).pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const current = yield* Store.get(taskStates);
            yield* Effect.forEach(
              current.filter((task) => task.status === "done"),
              (task) => tasks.remove({ id: task.id }),
              { discard: true },
            );
          }),
        ),
      );

      const reopenFirstBlocked = yield* Event.make<void>({ name: "reopenFirstBlocked" }).pipe(
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
          view,
          taskUnits: tasks.items,
          setDraft: Event.setter(draft, { name: "setDraft" }),
          create,
          remove,
          clearDone,
          reopenFirstBlocked,
        },
      };
    }),
}) {}
