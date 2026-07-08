import * as Option from "effect/Option";
import * as React from "react";
import { Model, useEvent, useStore, View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import { AppModel } from "./model";
import { AppPages } from "./routes";
import { SessionModel } from "./session";

interface PageUnits {
  readonly session: Model.PortsOf<typeof SessionModel>;
}

const SessionBadge = ({ session }: { readonly session: PageUnits["session"] }) => {
  const user = useStore(session.ui.user);
  const logout = useEvent(session.ui.logout);
  return Option.isNone(user) ? (
    <span className="muted">anonymous</span>
  ) : (
    <span className="row">
      {user.value}
      <button onClick={() => logout()}>Log out</button>
    </span>
  );
};

const LoginForm = ({
  session,
  onDone,
}: {
  readonly session: PageUnits["session"];
  readonly onDone: () => void;
}) => {
  const login = useEvent(session.ui.login);
  const [name, setName] = React.useState("ada");
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        login(name);
        onDone();
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <button type="submit">Log in</button>
    </form>
  );
};

const Outlet = RouterView.make<typeof AppPages, PageUnits>(AppPages, {
  routes: {
    home: ({ units, children }) => (
      <main className="shell">
        <nav className="row">
          <Link to="/">
            Home
          </Link>
          {/* Navigating here while logged out redirects to /login BEFORE
              the URL changes — no flash of /admin. */}
          <Link to="/admin">
            Admin
          </Link>
          <SessionBadge session={units.session} />
        </nav>
        {children ?? <p className="muted">Try Admin while logged out.</p>}
      </main>
    ),
    login: ({ router, units }) => (
      <section>
        <h2>Log in</h2>
        <LoginForm session={units.session} onDone={() => router.navigate({ to: "/admin" })} />
      </section>
    ),
    admin: ({ match }) => (
      <section>
        <h2>Admin</h2>
        {/* The guard's Provides, typed: `user` EXISTS here — the route could
            not have opened otherwise. */}
        <p>
          Welcome, <strong>{match.provided.user}</strong>.
        </p>
      </section>
    ),
  },
  notFound: () => <div className="state">404</div>,
});

export const App: React.FC<{ readonly unit: Model.PortsOf<typeof AppModel> }> = View.make(
  AppModel,
  ({ pages, session }) => <Outlet unit={pages} units={{ session }} />,
);
