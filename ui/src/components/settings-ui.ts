import { html, nothing, type TemplateResult } from "lit";

export function renderDocsLink(url: string, label: string): TemplateResult {
  return html`<a href=${url} target="_blank" rel="noopener noreferrer">${label}</a>`;
}

export function renderSettingsStatus(params: { kind: string; label: string }): TemplateResult {
  return html`<span class="settings-status settings-status--${params.kind}">${params.label}</span>`;
}

export function renderSettingsEmpty(content: unknown): TemplateResult {
  return html`<p class="settings-empty">${content}</p>`;
}

export function renderSettingsSecretInput(params: {
  ariaLabel: string;
  value: string;
  placeholder: string;
  visible: boolean;
  showLabel: string;
  hideLabel: string;
  toggleLabel: string;
  onInput: (next: string) => void;
  onToggle: () => void;
}): TemplateResult {
  return html`<span class="settings-secret">
    <input
      type=${params.visible ? "text" : "password"}
      autocomplete="off"
      spellcheck="false"
      aria-label=${params.ariaLabel}
      placeholder=${params.placeholder}
      .value=${params.value}
      @input=${(event: Event) => params.onInput((event.currentTarget as HTMLInputElement).value)}
    />
    <button
      type="button"
      class="settings-secret__toggle"
      aria-label=${params.toggleLabel}
      aria-pressed=${params.visible ? "true" : "false"}
      @click=${() => params.onToggle()}
    >
      ${params.visible ? params.hideLabel : params.showLabel}
    </button>
  </span>`;
}

export function renderSettingsRow(params: {
  title: string;
  description: unknown;
  stacked?: boolean;
  control: unknown;
}): TemplateResult {
  return html`<div class="settings-row${params.stacked ? " settings-row--stacked" : ""}">
    <div>
      <div class="settings-row__title">${params.title}</div>
      <div class="settings-row__description">${params.description}</div>
    </div>
    <div class="settings-row__control">${params.control}</div>
  </div>`;
}

export function renderSettingsSection(
  params: { title: string; description?: string; count?: number },
  content: unknown,
): TemplateResult {
  return html`<section class="settings-section">
    <header>
      <h2>${params.title}</h2>
      ${params.count != null ? html`<span>${params.count}</span>` : nothing}
      ${params.description ? html`<p>${params.description}</p>` : nothing}
    </header>
    ${content}
  </section>`;
}

export function renderSettingsPage(content: unknown, options?: { intro?: string }): TemplateResult {
  return html`<div class="settings-page">
    ${options?.intro ? html`<p>${options.intro}</p>` : nothing} ${content}
  </div>`;
}
