# Architecture plans

## Route-forwarded page models as keyed models, materialized lazily on match

Status: RESOLVED — shipped, but via a smaller mechanism than "the landed
idea" below originally proposed. Kept for the problem statement and the
rejected-options reasoning, both still accurate; the "landed idea" and "why
this needs its own pass" sections are OUTDATED — see "What actually shipped"
at the bottom.

### Problem

`Store.input()` for a route-forwarded field (e.g. `usersList`) needs SOME
initial value before the router's first forward lands, because `makePages`
currently constructs EVERY page model eagerly (`Model.get(pageModel)` for
every entry in the `PageMap`, regardless of which route is active) — the
page model's own `make()` completes, in full, before `makePages` even knows
what to forward into it. The placeholder is fine for a plain `ui` re-export
(a View re-renders once the real value lands), but genuinely wrong for
anything the page model uses AT CONSTRUCTION time (e.g. a `Query`
dependency) — it fires once against garbage, then self-corrects. That's not
a bug exactly, but it's not the "never `Option`, only written while matched"
guarantee the docs currently claim either.

### Options explored and why they were rejected

- **`Option`-wrap `Store.input`, unwrap in `InputValue`/`makePages`** —
  works, no deadlock, but doesn't remove the "one wrong fetch on first
  load" behavior, just makes the model able to detect and skip it. Still
  viable as a smaller, independent fix if the bigger plan below doesn't
  happen.
- **`Model.requiredInput()` + a `Model.get` overload returning a
  `PendingGet` that only resolves via `.pipe(Model.forward(values))`** —
  rejected: still writes into ports AFTER the child's own `make()` runs
  (same ordering as today), so it doesn't actually remove the race; only
  adds ceremony.
- **`Event.waitFor()` inside `make()` to block until the router forwards** —
  rejected: hard deadlock. `makePages` writes into a page model's ports
  only after `Model.get(pageModel)` (i.e. the WHOLE `make()`) completes, so
  a `make()` that blocks waiting for that write can never unblock.
- **A `Store`/`Event` reference as a keyed-model key** (see the OTHER new
  thing this session — `Model.get(Child, someParentStore)`, `KeyInput` in
  `packages/core/src/model.ts` accepts `Pipeable`/`Equal` values, not just
  primitives, bundled in a record or nested arbitrarily deep) — this
  genuinely works for the general "parent already has a live store, child
  needs it from construction" case (documented in `model.mdx`, "Keying On a
  Live Store"). It does NOT directly solve route-forwarding as-is, because
  the route's `Route.Output` isn't a stable pre-existing reference the
  parent hands over — it's recomputed per navigation, and only resolves
  AFTER `makePages` would today already have called `Model.get(pageModel)`.
  **This is exactly what shipped, generalized** — see below.

### What actually shipped (smaller than "the landed idea" below)

UPDATE: the `routeView` combinator described below was later removed —
`View.make`'s existing self-leasing overload got a generic
`SelfLeasedTypeId` marker (`@unitflow/react`) instead of the router-specific
`RouteFedTypeId`, so a route-fed page is now just a bare
`View.make(Model, render, {})` placed directly in the routes map;
`RouterView.make` recognizes it from the value alone and feeds the match's
`Route.Output` in as `modelKey`. Same mechanism, one fewer exported name.
The reasoning below (keyed model, lazy lease, `collectPageModels` skip) is
otherwise still accurate.

`makePages`/`PageMap`/`ValidatePageMap` were NOT reworked — they're
untouched, still eager, still `Model.Singleton`-only, still exactly as
published in `router@0.4.0`. Instead:

1. A route-fed page model is a KEYED model, keyed by `Route.Output<R>` —
   same shape "the landed idea" below proposed
   (`Model.Service<X>()(id)<Route.Output<R>>()({ make: (provided) => ... })`).
2. A new combinator, `routeView` (`@unitflow/router/react`), pairs that
   keyed model with its render function — the router's `React` binding
   leases the model itself, lazily, via `@unitflow/react`'s already-tested
   `useModel`/`ModelResult` (`Building`/`Ready`/`Failed`), the moment its
   route first matches. `collectPageModels` skips these entries entirely
   (a runtime marker, `RouteFedTypeId`, tells a `routeView` entry apart
   from a `View.make` one — both are callable with a `.model` static).
3. Every EXISTING singleton-page-model use case (`makePages`,
   `RouterView.make` with a plain `View.make` component) is completely
   unaffected — `routeView` is an alternative entry, not a replacement.
4. The "flat by contract" key restriction that made step 1 impossible for
   non-trivial route data (e.g. `usersList: ReadonlyArray<User>` — an
   array field fails a flat-record check) was ALSO lifted this session:
   `KeyInput`/`KeyField` now recurse through arrays and nested plain
   objects at any depth, rejecting only an `Event` reference, at any depth.
5. Instance lifetime (the open question below): left as normal
   `idleTimeToLive`, no special disposal on route un-match — confirmed in
   conversation.

Net effect: the "why this needs its own pass" concern below (reworking the
published `makePages`/`RouterView.make` core) never materialized — the
smaller `routeView` mechanism sidesteps that entirely by leasing the keyed
model OUTSIDE `makePages`, not by changing how `makePages` itself works.

### The landed idea (superseded by "What actually shipped" above)

Flip `makePages` from eager to lazy, and key page models by their route's
`Route.Output`:

1. A route-fed page model becomes a KEYED model:
   `Model.Service<X>()(id)<Route.Output<R>>()({ make: (provided) => ... })`
   — `provided` is real, typed, non-`Option` data from the first line, no
   placeholder anywhere.
2. `makePages` no longer eagerly leases every entry in the `PageMap` at its
   own construction. Instead it subscribes to `router.outputs.matches` and,
   the first time a route becomes matched, calls
   `Model.get(pageModel, match.provided)` for THAT route only — genuinely
   lazy, keyed by the real data.
3. `PageMap`/`ValidatePageMap` (currently built around `Model.Singleton`)
   need reworking to accept a KEYED model whose `Key` matches
   `Route.Output<R>` instead.
4. `RouterView.make` calls `makePages` internally — same rework ripples
   through it (`collectPageModels`, the `ValidateRoutesConfig` machinery).
5. Open question: instance lifetime — see "What actually shipped" above
   (resolved: normal `idleTimeToLive`, no special disposal).
