import { fileURLToPath } from "node:url";
import type { AliasOptions } from "vite";

const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export const unitflowAliases: AliasOptions = [
  { find: "@unitflow/core/event", replacement: fromRoot("packages/core/src/event.ts") },
  { find: "@unitflow/core/model", replacement: fromRoot("packages/core/src/model.ts") },
  { find: "@unitflow/core/registry", replacement: fromRoot("packages/core/src/registry.ts") },
  { find: "@unitflow/core/query", replacement: fromRoot("packages/core/src/query.ts") },
  { find: "@unitflow/core/runtime", replacement: fromRoot("packages/core/src/runtime.ts") },
  { find: "@unitflow/core/store", replacement: fromRoot("packages/core/src/store.ts") },
  { find: "@unitflow/react", replacement: fromRoot("packages/react/src/index.ts") },
  { find: "@unitflow/core", replacement: fromRoot("packages/core/src/index.ts") },
];
