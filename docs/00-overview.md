# Unitflow Overview

Unitflow brings UI behavior into the Effect runtime.

A Unitflow model is a UI-facing Effect Service: it owns state, actions, async
work, child models, and lifetime, and it composes through Effect dependency
injection. Views render the model's `ui` at the edge.

Read the concepts in this order:

```txt
Stores            -> state: make, get, set, derive, changed
Events            -> actions: make, emit, handler
Model             -> Effect service, contract, dependencies, children
Queries           -> async reads
Mutations         -> async writes
React Binding     -> render the model's ui
Testing           -> layers, fakes, allSettled
Streams           -> advanced pipelines
Lifetime          -> scopes, TTL, finalizers
```

Every model returns at least:

```ts
return {
  inputs: {},
  outputs: {},
  ui: {},
};
```

`inputs` are actions other code may trigger. `outputs` are state or events other
code may observe. `ui` is the complete surface a View receives.
