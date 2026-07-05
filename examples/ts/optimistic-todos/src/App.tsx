import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { View } from "@unitflow/react";
import { TodosModel } from "./model";

export const TodosApp = View.make(TodosModel, (unit) => {
  const todos = AsyncResult.value(unit.todos);

  return (
    <main className="todos-shell">
      <h1>Optimistic Todos</h1>

      <form
        className="todos-form"
        onSubmit={(event) => {
          event.preventDefault();
          unit.submit();
        }}
      >
        <input
          placeholder="What needs doing?"
          value={unit.draft}
          onChange={(event) => unit.setDraft(event.currentTarget.value)}
        />
        <button type="submit">Add</button>
      </form>

      <label className="todos-failure">
        <input
          type="checkbox"
          checked={unit.simulateFailure}
          onChange={(event) => unit.setSimulateFailure(event.currentTarget.checked)}
        />
        <span>Fail the next save (watch the rollback)</span>
      </label>

      {AsyncResult.isFailure(unit.saveState) ? (
        <div className="todos-error" role="alert">
          Save failed — the optimistic todo was rolled back.
        </div>
      ) : null}

      {Option.isNone(todos) ? (
        <div className="todos-status">Loading…</div>
      ) : (
        <ul className="todos-list">
          {todos.value.map((todo) => (
            <li key={todo.id} className={todo.pending === true ? "pending" : ""}>
              <span>{todo.title}</span>
              {todo.pending === true ? <em>saving…</em> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
});
