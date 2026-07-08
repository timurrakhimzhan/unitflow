import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
  },
  webServer: [
    {
      command:
        "pnpm --filter @unitflow/example-router-basic build && pnpm --filter @unitflow/example-router-basic preview",
      port: 4406,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --filter @unitflow/example-router-guard build && pnpm --filter @unitflow/example-router-guard preview",
      port: 4407,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
