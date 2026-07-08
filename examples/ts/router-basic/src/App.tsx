import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import type { User } from "./api";
import { AppPages, UserPageModel, UsersPageModel } from "./routes";

const Pending = () => <div className="state">Loading…</div>;

const UsersPage = View.make(UsersPageModel, ({ list, reload }) => {
  const value = AsyncResult.value(list);
  if (Option.isNone(value)) {
    return AsyncResult.isFailure(list) ? <div className="state">Closed</div> : <Pending />;
  }
  return (
    <section>
      <header className="row">
        <h2>People</h2>
        <button onClick={() => reload()}>Reload</button>
      </header>
      <ul className="cards">
        {value.value.map((user: User) => (
          <li key={user.id}>
            {/* to/params/search are typed against the route table */}
            <Link to="/users/:id" params={{ id: user.id }} search={{ page: 1 }}>
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
});

const UserPage = View.make(UserPageModel, ({ user, search }, { id }: { readonly id: number }) => {
  const value = AsyncResult.value(user);
  const page = Option.getOrElse(
    Option.map(search, (current) => current.page),
    () => 1,
  );
  if (Option.isNone(value)) {
    return AsyncResult.isFailure(user) ? <div className="state">Not found</div> : <Pending />;
  }
  return (
    <section>
      <h2>{value.value.name}</h2>
      <p className="muted">{value.value.role}</p>
      <p>{value.value.bio}</p>
      <footer className="row">
        <span className="muted">page {page} (from ?page=)</span>
        {/* Same route, different search: pagination through the URL. */}
        <Link to="/users/:id" params={{ id }} search={{ page: page + 1 }}>
          Next page
        </Link>
        <Link to="/users">Back</Link>
      </footer>
    </section>
  );
});

/** The single meeting point of routes and React. Each view whose route is
 * in the pages map receives that model's unit as `page` — no manual
 * leasing, no threading. */
export const Outlet = RouterView.make(AppPages, {
  routes: {
    home: ({ children }) => (
      <main className="shell">
        <nav className="row">
          <Link to="/">Home</Link>
          <Link to="/users">People</Link>
        </nav>
        {children ?? <p className="muted">Pick a page — data loads when its route opens.</p>}
      </main>
    ),
    users: ({ page }) => <UsersPage unit={page} />,
    user: ({ page, match }) => (
      <>
        <p className="muted">URL params, decoded: id = {match.params.id}</p>
        <UserPage unit={page} id={match.params.id} />
      </>
    ),
  },
  notFound: () => <div className="state">404</div>,
});
