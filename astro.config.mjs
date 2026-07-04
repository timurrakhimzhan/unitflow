import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Unitflow",
      description: "Effect-native UI state management with scoped models and typed ports.",
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { slug: "overview" },
            { slug: "store" },
            { slug: "events" },
            { slug: "model-contract" },
            { slug: "resource-mutation" },
          ],
        },
        {
          label: "Patterns",
          items: [
            { slug: "react" },
            { slug: "testing" },
            { slug: "lifetime" },
          ],
        },
        {
          label: "Examples",
          items: [
            { slug: "examples/project-picker" },
            { slug: "examples/render-model" },
          ],
        },
      ],
    }),
  ],
});
