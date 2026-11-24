import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("my-api-keys"),
  component: () =>
    import("./my-api-keys-page.ts").then(() => ({
      header: true,
      renderSolid: () => document.createElement("openclaw-my-api-keys-page"),
    })),
});
