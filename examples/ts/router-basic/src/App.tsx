import type * as React from "react";
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import type { User } from "./api";
import { AppRouter, UserPageModel, UsersPageModel } from "./routes";

const roles = ["Analyst", "Professor"] as const;

const UsersPage = View.make(
  UsersPageModel,
  ({ list }, { children }: { readonly children?: React.ReactNode }) => {
    if (children !== undefined && children !== null) return <>{children}</>;
    return (
      <section>
        <header className="row">
          <h2>People</h2>
          <Link to="/users" search={{}} data-testid="filter-all">
            All
          </Link>
          {roles.map((role) => (
            <Link key={role} to="/users" search={{ filter: { role } }} data-testid={`filter-${role}`}>
              {role}
            </Link>
          ))}
        </header>
        <ul className="cards">
          {list.map((user: User) => (
            <li key={user.id}>
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
  {},
);

const UserPage = View.make(
  UserPageModel,
  ({ profile, params, search }) => (
    <section>
      <h2>{profile.name}</h2>
      <p className="muted">{profile.role}</p>
      <p>{profile.bio}</p>
      <footer className="row">
        <span className="muted">
          middleware data: id = {params.id}, page = {search.page}
        </span>
        <Link to="/users/:id" params={{ id: params.id }} search={{ page: search.page + 1 }}>
          Next page
        </Link>
        <Link to="/users">Back</Link>
      </footer>
    </section>
  ),
  {},
);

/** Both pages are keyed by their route middleware output. RouterView leases a
 * model only after navigation has loaded and validated that output. */
export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    home: ({ children }) => (
      <main className="shell">
        <nav className="row">
          <Link to="/">Home</Link>
          <Link to="/users">People</Link>
        </nav>
        {children ?? <p className="muted">Pick a page — middleware loads it before commit.</p>}
      </main>
    ),
    users: { view: UsersPage, routes: { user: UserPage } },
  },
  notFound: () => <div className="state">404</div>,
});
