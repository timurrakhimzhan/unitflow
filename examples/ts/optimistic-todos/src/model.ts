import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Event, Model, Mutation, Query, Store } from "@unitflow/react";
import { TodosApi } from "./todos-api";

/** An optimistic row carries a pending marker until the server confirms. */
export interface TodoRow {
  readonly id: string;
  readonly title: string;
  readonly pending?: boolean;
}

export class TodosModel extends Model.Service<TodosModel>()(
  "@unitflow/example/optimistic-todos",
)({
  make: () =>
    Effect.gen(function* () {
      const draft = Store.make("");
      const simulateFailure = Store.make(false);

      const todos = yield* Query.make(
        Effect.gen(function* () {
          const api = yield* TodosApi;
          return (yield* api.list()) as ReadonlyArray<TodoRow>;
        }),
      );

      const save = yield* Mutation.make((input: { title: string; fail: boolean }) =>
        Effect.gen(function* () {
          const api = yield* TodosApi;
          return yield* api.save(input);
        }),
      );

      const submit = yield* Event.make<void>().pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const title = (yield* Store.get(draft)).trim();
            if (title === "") return;
            const fail = yield* Store.get(simulateFailure);
            yield* Store.set(draft, "");

            // Apply the change to the query state before the server confirms.
            yield* Store.update(todos.state, (current) =>
              Option.match(AsyncResult.value(current), {
                onNone: () => current,
                onSome: (list) =>
                  AsyncResult.success<ReadonlyArray<TodoRow>>([
                    ...list,
                    { id: `pending:${title}`, title, pending: true },
                  ]),
              }),
            );

            // Either way the server is the source of truth: confirm on
            // success, roll back on failure — both are just a refresh.
            yield* Mutation.call(save.run, { title, fail }).pipe(
              Effect.flatMap(() => Event.emit(todos.refresh)),
              Effect.catchCause(() => Event.emit(todos.refresh)),
            );
          }),
        ),
      );

      return {
        inputs: { submit, refresh: todos.refresh },
        outputs: { todos: todos.state },
        ui: {
          todos: todos.state,
          saveState: save.state,
          draft,
          setDraft: Event.setter(draft),
          simulateFailure,
          setSimulateFailure: Event.setter(simulateFailure),
          submit,
        },
      };
    }),
}) {}
