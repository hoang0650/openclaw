import { LitElement } from "lit";

/** Light-DOM Lit base kept for fork pages that render into the app shell. */
export class OpenClawLightDomElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}
