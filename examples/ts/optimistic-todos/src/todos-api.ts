import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface Todo {
  readonly id: string;
  readonly title: string;
}

export interface SaveInput {
  readonly title: string;
  /** Demo knob: the server rejects the write when set. */
  readonly fail: boolean;
}

export interface TodosApiShape {
  readonly list: () => Effect.Effect<ReadonlyArray<Todo>, never>;
  readonly save: (input: SaveInput) => Effect.Effect<Todo, string>;
}

export class TodosApi extends Context.Service<TodosApi, TodosApiShape>()(
  "@unitflow/example/optimistic-todos/TodosApi",
) {}

/** In-memory backend with a visible round trip, so the optimistic value is
 * on screen long before the server confirms it. */
export const todosApi = (() => {
  const todos: Array<Todo> = [
    { id: "todo-1", title: "Sketch the model" },
    { id: "todo-2", title: "Wire the query" },
    { id: "todo-3", title: "Ship the example" },
  ];
  let nextId = 4;

  return TodosApi.of({
    list: () =>
      Effect.gen(function* () {
        yield* Effect.sleep("400 millis");
        return [...todos];
      }),

    save: ({ title, fail }) =>
      Effect.gen(function* () {
        yield* Effect.sleep("700 millis");
        if (fail) {
          return yield* Effect.fail("The server rejected this todo.");
        }
        const todo: Todo = { id: `todo-${nextId++}`, title };
        todos.push(todo);
        return todo;
      }),
  });
})();
