---
title: Dynamic Render Model
description: A keyed Unitflow child model for parallel render lifecycles.
---

Dynamic models are keyed by flat data.

```ts
type RenderKey = {
  readonly projectId: ProjectId;
  readonly renderId: GenerationId;
};

export class RenderModel extends Model.Service<RenderModel>()("widgets/render")<RenderKey>()({
  make: (key) =>
    Effect.gen(function* () {
      const client = yield* DomainRpcClient;

      const stage = Store.make<RenderStage>(RenderStage.Idle());
      const opened = Event.make<{ readonly id: GenerationId }>();

      const start = yield* Event.make<RenderRequest>().pipe(
        Event.handler((request) =>
          client.renderPipeline(request).pipe(
            Stream.mapEffect((event) => Store.set(stage, RenderStage.fromPipelineEvent(event))),
            Stream.runDrain,
            Effect.catchCause((cause) => Store.set(stage, RenderStage.Failed({ cause }))),
          ),
        ),
      );

      return {
        inputs: { start },
        outputs: { stage, opened },
        ui: {
          stage,
          open: Event.make<{ readonly id: GenerationId }>().pipe(
            Event.handler((value) => Event.emit(opened, value)),
          ),
        },
      };
    }),
}) {}
```

If this appears in a list, the parent owns each child instance. Removing an item
from the list should dispose that child and interrupt its pipelines.
