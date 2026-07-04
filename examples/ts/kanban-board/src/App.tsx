import { View } from "@unitflow/react";
import { BoardModel, type TaskStatus, TaskModel } from "./model";

const statuses: ReadonlyArray<TaskStatus> = ["todo", "doing", "done"];

const TaskCard = View.make(
  TaskModel,
  (task, props: { readonly onRemove: () => void }) => (
    <article className="task-card" data-blocked={task.state.blocked ? "true" : undefined}>
      <input
        className="task-title"
        value={task.state.title}
        onChange={(event) => task.rename(event.currentTarget.value)}
      />

      <div className="task-row">
        <label>
          <span>Assignee</span>
          <input
            value={task.state.assignee}
            onChange={(event) => task.assign(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="status-strip" aria-label="Task status">
        {statuses.map((status) => (
          <button
            type="button"
            key={status}
            data-active={task.state.status === status ? "true" : undefined}
            onClick={() => task.move(status)}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="task-footer">
        <button type="button" onClick={() => task.toggleBlocked()}>
          {task.state.blocked ? "Unblock" : "Block"}
        </button>
        <button type="button" onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </article>
  ),
);

export const BoardApp = View.make(BoardModel, (board) => (
  <main className="board-shell">
    <header className="board-header">
      <div>
        <h1>Delivery Board</h1>
        <p>
          {board.view.counts.todo} todo, {board.view.counts.doing} active,{" "}
          {board.view.counts.done} done
        </p>
      </div>

      <div className="board-actions">
        <button type="button" onClick={() => board.reopenFirstBlocked()}>
          Reopen blocked
        </button>
        <button type="button" onClick={() => board.clearDone()}>
          Clear done
        </button>
      </div>
    </header>

    <form
      className="new-task"
      onSubmit={(event) => {
        event.preventDefault();
        board.create();
      }}
    >
      <input
        value={board.view.draft}
        placeholder="Task title"
        onChange={(event) => board.setDraft(event.currentTarget.value)}
      />
      <button type="submit">Add task</button>
    </form>

    <section className="columns" aria-label="Tasks by status">
      {statuses.map((status) => (
        <div className="column" key={status}>
          <h2>{status}</h2>
          <div className="task-list">
            {board.taskUnits.map((task, index) => {
              const snapshot = board.view.taskStates[index];
              if (snapshot?.status !== status) return null;
              return (
                <TaskCard
                  key={snapshot.id}
                  unit={task}
                  onRemove={() => board.remove(snapshot.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </section>
  </main>
));
