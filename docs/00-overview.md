# Unitflow Overview

Unitflow is a UI state manager built around Effect concepts instead of a
framework-specific lifecycle.

The core idea:

```txt
Model.Service  -> dependency-injected controller
Store          -> scoped state source/sink
Event          -> discrete streamable fact or command
Registry       -> per-runtime state, event channels, fibers, allSettled
View.make      -> React binding over a model's ui ports
```

## Why

Atom-level state is flexible, but large UI systems need stronger answers:

- where feature boundaries live
- what public API a model exposes
- who may write, read, or subscribe
- how side effects are represented
- how dynamic model instances are keyed
- how model lifetime is tied to ownership
- how tests wait for reactive cascades deterministically

Unitflow answers those questions with a small shape:

```ts
return {
  inputs: {},
  outputs: {},
  ui: {},
};
```

`inputs` are write-only ports for outside control. `outputs` are read-only ports
for composition. `ui` is the only surface a View receives.

## Non Goals

- Reimplement all of Effector.
- Make callbacks the orchestration language.
- Hide Effect behind a new effect system.
- Make React hooks the owner of business state.

Unitflow should feel like Effect carried into UI state management.
