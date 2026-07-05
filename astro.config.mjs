import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  integrations: [
    starlight({
      title: "Unitflow",
      description: "Effect-native UI state management with scoped models.",
      logo: {
        src: "./src/assets/unitflow-logo.svg",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/timurrakhimzhan/unitflow",
        },
        {
          icon: "npm",
          label: "npm",
          href: "https://www.npmjs.com/package/@unitflow/core",
        },
      ],
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        {
          label: "Learn Unitflow",
          items: [
            { slug: "overview" },
            { slug: "install" },
            { slug: "recommendations" },
            { slug: "store" },
            { slug: "events" },
            { slug: "model" },
          ],
        },
        {
          label: "Async",
          items: [
            { slug: "queries" },
            { slug: "mutations" },
          ],
        },
        {
          label: "React and Tests",
          items: [
            { slug: "react" },
            { slug: "testing" },
          ],
        },
        {
          label: "Advanced",
          items: [
            { slug: "streams" },
            { slug: "lifetime" },
          ],
        },
        {
          label: "Examples",
          items: [
            { slug: "examples/counter" },
            { slug: "examples/query-search" },
            { slug: "examples/task-board" },
            { slug: "examples/paginated-table" },
            { slug: "examples/optimistic-todos" },
          ],
        },
      ],
    }),
  ],
});
