# Tweets to make

## routeView / Model.Keyed (was: Store.input() / Event.input())

Status: text + code ready, not posted. REWRITTEN — the original version below
used `Store.input()` for `usersList`, which this session removed entirely
(it invited reading a placeholder before the router's first forward landed —
a real race, not just cosmetic). The replacement, `routeView`, closes it by
construction: the page model is keyed by the route's own `Route.Output`, so
`usersList` is real data on the first line of `make()`, never a placeholder.

Text:

> small addition to unitflow: page models can now be keyed by their route's
> own data
>
> a route guard fetches the list and provides it; the page model declares it
> as its KEY, not an input — `make()` gets real, typed data on the first
> line, no placeholder, no `Option`, no race with the guard's fetch.

Screenshot 1 — router (guard → keyed page model):

```ts
class ListGuard extends Router.Middleware<ListGuard>()("ListGuard")<{
  readonly usersList: ReadonlyArray<User>;
}>() {}

const ListGuardLive = ListGuard.layer(() =>
  Effect.gen(function* () {
    const api = yield* UsersApi;
    const users = yield* api.list().pipe(
      Effect.catchCause(() => Effect.fail(new Router.RedirectError({ options: { to: "/error" } }))),
    );
    return { usersList: users };
  }),
);

export class UsersPageModel extends Model.Service<UsersPageModel>()(
  "UsersPage",
)<{ readonly usersList: ReadonlyArray<User> }>()({
  make: ({ usersList }) =>
    Effect.gen(function* () {
      const list = Store.make(usersList);
      return { inputs: {}, outputs: {}, ui: { usersList: list } };
    }),
}) {}

const UsersRoute = Route.make("users", { path: "/users" });
export const AppRouter = Router.make(
  "app-router",
  Route.group(UsersRoute).middleware(ListGuard),
);
```

Screenshot 2 — View + wiring (`routeView` instead of `View.make` — it leases
the keyed model itself, keyed by the matched route's output):

```tsx
const UsersView = routeView(UsersPageModel, ({ usersList }) => (
  <ul>{usersList.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
));

export const AppView = RouterView.make(AppRouter.model, {
  routes: { users: UsersView },
});
```

Both snippets compile-verified against the real package (scratch check
through `examples/ts/router-docs-check`) as of 2026-07-11.

## "do you believe it's a frontend code?"

Status: idea only, no code/caption written yet.

Concept: a code screenshot that reads like clean backend/domain code (Effect
service composition, typed errors, no JSX/DOM in sight) with a caption
along the lines of "do you believe it's a frontend code?" — the punchline
being that it *is* the frontend model layer, just written like a normal
Effect service. Needs: pick/write the actual snippet, nail the exact
caption wording.
