import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("my-api-keys"),
  component: () =>
    import("./my-api-keys-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-my-api-keys-page></openclaw-my-api-keys-page>`,
    })),
});
