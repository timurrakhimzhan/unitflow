import type { Debug } from "@unitflow/core";

/** Messages the in-app bridge sends to the MCP hub. */
export type BridgeMessage =
  | { readonly type: "hello"; readonly app: string }
  | { readonly type: "events"; readonly events: ReadonlyArray<Debug.DebugEvent> }
  | { readonly type: "snapshot"; readonly requestId: number; readonly snapshot: Debug.Snapshot };

/** Messages the MCP hub sends to the in-app bridge. */
export type HubMessage = { readonly type: "snapshot_request"; readonly requestId: number };

export const DEFAULT_PORT = 4477;
