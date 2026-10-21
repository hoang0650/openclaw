import { html, type TemplateResult } from "lit";

export function renderSettingsWorkspace(content: unknown): TemplateResult {
  return html`<div class="content content--settings-workspace">${content}</div>`;
}
