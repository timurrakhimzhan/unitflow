import { Debug } from "@unitflow/core";
import type { UnitflowRuntime } from "@unitflow/core/runtime";
import { connect, type BridgeOptions } from "./bridge.js";

export { connect, type BridgeOptions } from "./bridge.js";

export interface DevtoolsOptions extends BridgeOptions, Debug.AttachOptions {}

/**
 * The one-liner devtools setup: attaches the runtime inspector and streams it
 * to the local `unitflow-mcp` hub. Call it under a dev guard so production
 * builds tree-shake the whole module away:
 *
 * ```ts
 * if (import.meta.env.DEV) devtools(runtime);
 * ```
 *
 * Returns a stop function (disconnects the bridge and detaches the
 * inspector) — usually unneeded: the bridge dies with the page.
 */
export const devtools = (
  runtime: UnitflowRuntime<any, any>,
  options?: DevtoolsOptions,
): (() => void) => {
  let stop: (() => void) | undefined;
  let stopped = false;
  void runtime.runtime.runPromise(Debug.attach(options)).then((inspector) => {
    if (stopped) {
      inspector.detach();
      return;
    }
    const disconnect = connect(inspector, options);
    stop = () => {
      disconnect();
      inspector.detach();
    };
  });
  return () => {
    stopped = true;
    stop?.();
  };
};
