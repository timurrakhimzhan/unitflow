import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";
import type * as React from "react";
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import type { User } from "./api";
import { AppRouter, UserPageModel, UsersPageModel } from "./routes";

const Pending = () => <div className="state">Loading…</div>;

const roles = ["Analyst", "Professor"] as const;

const UsersPage = View.make(
  UsersPageModel,
  ({ list, search, reload }, { children }: { readonly children?: React.ReactNode }) => {
  // /users is also the PARENT of /users/:id: when a child match rendered
  // something, show it instead of the list.
  if (children !== undefined && children !== null) return <>{children}</>;
  const value = AsyncResult.value(list);
  if (Option.isNone(value)) {
    // waiting wins: the previous result may be the "closed" failure.
    return list.waiting || !AsyncResult.isFailure(list) ? (
      <Pending />
    ) : (
      <div className="state">Closed</div>
    );
  }
  return (
    <section>
      <header className="row">
        <h2>People</h2>
        {/* An OBJECT in the query string, typed end to end. */}
        <Link to="/users" search={{}} data-testid="filter-all">
          All
        </Link>
        {roles.map((role) => (
          <Link key={role} to="/users" search={{ filter: { role } }} data-testid={`filter-${role}`}>
            {role}
          </Link>
        ))}
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
  },
);

const UserPage = View.make(UserPageModel, ({ user, params, search }) => {
  const value = AsyncResult.value(user);
  const id = Option.map(params, (current) => current.id);
  const page = Option.getOrElse(
    Option.map(search, (current) => current.page),
    () => 1,
  );
  if (Option.isNone(value) || Option.isNone(id)) {
    return user.waiting || !AsyncResult.isFailure(user) ? (
      <Pending />
    ) : (
      <div className="state">Not found</div>
    );
  }
  return (
    <section>
      <h2>{value.value.name}</h2>
      <p className="muted">{value.value.role}</p>
      <p>{value.value.bio}</p>
      <footer className="row">
        <span className="muted">
          route data through the model: id = {id.value}, page = {page}
        </span>
        {/* Same route, different search: pagination through the URL. */}
        <Link to="/users/:id" params={{ id: id.value }} search={{ page: page + 1 }}>
          Next page
        </Link>
        <Link to="/users">Back</Link>
      </footer>
    </section>
  );
});

/** ONE map stitches routes, models, and views: a plain function is a view
 * (with its route's narrowed `match`), a View.make component IS its own
 * entry — the router leases its model and hands the unit back in. `user`
 * nests under `users` — mirroring `UsersRoute.pipe(Route.addChild(UserRoute))`
 * in routes.ts — so `UserPage`'s rendered output arrives as `UsersPage`'s
 * `children` only while `/users/:id` is actually matched. */
export const AppView = RouterView.make(AppRouter.model, {
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
    users: { view: UsersPage, routes: { user: UserPage } },
  },
  notFound: () => <div className="state">404</div>,
});
