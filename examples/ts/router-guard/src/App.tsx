import * as Option from "effect/Option";
import * as React from "react";
import * as Effect from "effect/Effect";
import { Model, useEvent, useStore, View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import { AppRouter } from "./routes";
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

export const AppView = RouterView.make<typeof AppRouter.model, PageUnits>(AppRouter.model, {
  routes: {
    // home/login/admin are independent pages that merely SHARE this nav —
    // declared via `Route.layout("shell")` in routes.ts, mirrored here as
    // the shell's own view wrapping all three as nested entries.
    shell: {
      view: ({ units, children }) => (
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
          {children}
        </main>
      ),
      routes: {
        home: () => <p className="muted">Try Admin while logged out.</p>,
        login: ({ router, units }) => (
          <section>
            <h2>Log in</h2>
            <LoginForm session={units.session} onDone={() => router.navigate({ to: "/admin" })} />
          </section>
        ),
        admin: ({ match }) => (
          <section>
            <h2>Admin</h2>
            {/* The guard's Provides, typed: `user` EXISTS here — the route
                could not have opened otherwise. */}
            <p>
              Welcome, <strong>{match.provided.user}</strong>.
            </p>
          </section>
        ),
      },
    },
  },
  notFound: () => <div className="state">404</div>,
});

/** The root: owns the view tree's pages model and the session — `units` is
 * the escape hatch for units that are not a route's page. Declared AFTER
 * AppView so the module stays cycle-free. */
export class AppModel extends Model.Service<AppModel>()(
  "@unitflow/example/router-guard/App",
)({
  make: () =>
    Effect.gen(function* () {
      const pages = yield* Model.get(AppView.model);
      const session = yield* Model.get(SessionModel);
      return {
        inputs: {},
        outputs: {},
        ui: { pages, session },
      };
    }),
}) {}

export const App: React.FC<{ readonly unit: Model.PortsOf<typeof AppModel> }> = View.make(
  AppModel,
  ({ pages, session }) => <AppView unit={pages} units={{ session }} />,
);
