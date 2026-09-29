import { html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { titleForRoute } from "../../app-navigation.ts";
import { readAimarketsTicket } from "../../app/aimarkets-ticket.ts";
import { resolveOpenClawAudience } from "../../app/audience-models.ts";
import {
  renderDocsLink,
  renderSettingsEmpty,
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSecretInput,
  renderSettingsSection,
  renderSettingsStatus,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  BYOK_PROVIDER_MODELS,
  ByokApiError,
  deleteKey,
  listKeys,
  listProviders,
  saveKey,
  testKey,
  type ByokKey,
  type ByokProvider,
} from "./api.ts";

type Draft = { apiKey: string; baseUrl: string; model: string; visible: boolean };
type BusyAction = "save" | "test" | "remove";
type Notice = { kind: "ok" | "danger"; text: string };

function errorText(err: unknown): string {
  if (err instanceof ByokApiError || err instanceof Error) {
    return err.message;
  }
  return String(err);
}

class MyApiKeysPage extends OpenClawLightDomElement {
  @state() private providers: ByokProvider[] = [];
  @state() private keys: Record<string, ByokKey> = {};
  @state() private drafts: Record<string, Draft> = {};
  @state() private busy: Record<string, BusyAction | undefined> = {};
  @state() private notices: Record<string, Notice | undefined> = {};
  @state() private loading = true;
  @state() private loadError: string | null = null;
  @state() private ticketMissing = false;

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private ticket(): string | null {
    return readAimarketsTicket()?.ticket ?? null;
  }

  private async load() {
    this.loading = true;
    this.loadError = null;
    const ticket = this.ticket();
    this.ticketMissing = !ticket;
    try {
      const [providers, keys] = await Promise.all([
        listProviders(),
        ticket ? listKeys(ticket) : Promise.resolve([] as ByokKey[]),
      ]);
      this.providers = providers;
      this.keys = Object.fromEntries(keys.map((key) => [key.provider, key]));
    } catch (err) {
      if (err instanceof ByokApiError && err.code === "MARKET_TICKET_INVALID") {
        this.ticketMissing = true;
      } else {
        this.loadError = errorText(err);
      }
    } finally {
      this.loading = false;
    }
  }

  private draftFor(provider: string): Draft {
    const saved = this.keys[provider];
    return (
      this.drafts[provider] ?? {
        apiKey: "",
        baseUrl: saved?.baseUrl ?? "",
        model: saved?.model ?? "",
        visible: false,
      }
    );
  }

  private updateDraft(provider: string, patch: Partial<Draft>) {
    this.drafts = { ...this.drafts, [provider]: { ...this.draftFor(provider), ...patch } };
  }

  private setNotice(provider: string, notice: Notice | undefined) {
    this.notices = { ...this.notices, [provider]: notice };
  }

  private async run(provider: string, action: BusyAction, work: (ticket: string) => Promise<void>) {
    const ticket = this.ticket();
    if (!ticket) {
      this.ticketMissing = true;
      return;
    }
    this.busy = { ...this.busy, [provider]: action };
    this.setNotice(provider, undefined);
    try {
      await work(ticket);
    } catch (err) {
      if (err instanceof ByokApiError && err.code === "MARKET_TICKET_INVALID") {
        this.ticketMissing = true;
      }
      this.setNotice(provider, {
        kind: "danger",
        text: t("myApiKeysPage.requestFailed", { error: errorText(err) }),
      });
      if (action === "test") {
        await this.refreshKeys(ticket);
      }
    } finally {
      this.busy = { ...this.busy, [provider]: undefined };
    }
  }

  private async refreshKeys(ticket: string) {
    try {
      const keys = await listKeys(ticket);
      this.keys = Object.fromEntries(keys.map((key) => [key.provider, key]));
    } catch {
      // Keep the previous list; the action notice already explains the failure.
    }
  }

  private save(provider: ByokProvider) {
    const draft = this.draftFor(provider.id);
    void this.run(provider.id, "save", async (ticket) => {
      const key = await saveKey(ticket, provider.id, {
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        ...(provider.custom ? { baseUrl: draft.baseUrl.trim(), model: draft.model.trim() } : {}),
      });
      this.keys = { ...this.keys, [provider.id]: key };
      this.updateDraft(provider.id, { apiKey: "", visible: false });
      this.setNotice(provider.id, { kind: "ok", text: t("myApiKeysPage.saved") });
    });
  }

  private test(provider: ByokProvider) {
    void this.run(provider.id, "test", async (ticket) => {
      const key = await testKey(ticket, provider.id);
      this.keys = { ...this.keys, [provider.id]: key };
      this.setNotice(provider.id, { kind: "ok", text: t("myApiKeysPage.tested") });
    });
  }

  private remove(provider: ByokProvider) {
    if (!globalThis.confirm(t("myApiKeysPage.removeConfirm", { provider: provider.label }))) {
      return;
    }
    void this.run(provider.id, "remove", async (ticket) => {
      await deleteKey(ticket, provider.id);
      const next = { ...this.keys };
      delete next[provider.id];
      this.keys = next;
      const drafts = { ...this.drafts };
      delete drafts[provider.id];
      this.drafts = drafts;
      this.setNotice(provider.id, { kind: "ok", text: t("myApiKeysPage.removed") });
    });
  }

  private renderStatus(saved: ByokKey | undefined) {
    if (!saved) {
      return renderSettingsStatus({ kind: "muted", label: t("myApiKeysPage.notSaved") });
    }
    if (saved.status === "invalid") {
      return renderSettingsStatus({
        kind: "danger",
        label: t("myApiKeysPage.invalidKey", { last4: saved.last4 }),
      });
    }
    return renderSettingsStatus({
      kind: "ok",
      label: t("myApiKeysPage.savedKey", { last4: saved.last4 }),
    });
  }

  private renderProvider(provider: ByokProvider) {
    const saved = this.keys[provider.id];
    const draft = this.draftFor(provider.id);
    const busy = this.busy[provider.id];
    const notice = this.notices[provider.id];
    const models = BYOK_PROVIDER_MODELS[provider.id] ?? [];
    const customEndpointChanged =
      Boolean(provider.custom && saved) &&
      (draft.baseUrl !== saved?.baseUrl || draft.model !== saved?.model);
    const canSave = !busy && (Boolean(draft.apiKey.trim()) || customEndpointChanged);
    const description = html`
      ${this.renderStatus(saved)}
      ${saved?.lastVerifiedAt
        ? html` ·
          ${t("myApiKeysPage.verifiedAt", {
            time: new Date(saved.lastVerifiedAt).toLocaleString(),
          })}`
        : nothing}
      ${models.length > 0
        ? html`<br />${t("myApiKeysPage.modelsHint", { models: models.join(", ") })}`
        : nothing}
      ${provider.keyUrl
        ? html`<br />${renderDocsLink(provider.keyUrl, t("myApiKeysPage.getKey"))}`
        : nothing}
      ${notice
        ? html`<br /><span role=${notice.kind === "danger" ? "alert" : "status"}
              >${renderSettingsStatus({ kind: notice.kind, label: notice.text })}</span
            >`
        : nothing}
    `;
    return html`
      ${renderSettingsRow({
        title: provider.label,
        description,
        stacked: true,
        control: html`
          <form
            class="my-api-keys__form"
            style="display:flex;flex-direction:column;gap:8px;width:100%"
            @submit=${(event: SubmitEvent) => {
              event.preventDefault();
              if (canSave) {
                this.save(provider);
              }
            }}
          >
            ${provider.custom
              ? html`
                  <input
                    class="settings-input"
                    type="url"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    aria-label=${t("myApiKeysPage.baseUrl")}
                    title=${t("myApiKeysPage.baseUrlHint")}
                    placeholder=${t("myApiKeysPage.baseUrlPlaceholder")}
                    .value=${draft.baseUrl}
                    ?disabled=${Boolean(busy)}
                    @input=${(event: Event) =>
                      this.updateDraft(provider.id, {
                        baseUrl: (event.currentTarget as HTMLInputElement).value,
                      })}
                  />
                  <input
                    class="settings-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    aria-label=${t("myApiKeysPage.model")}
                    placeholder=${t("myApiKeysPage.modelPlaceholder")}
                    .value=${draft.model}
                    ?disabled=${Boolean(busy)}
                    @input=${(event: Event) =>
                      this.updateDraft(provider.id, {
                        model: (event.currentTarget as HTMLInputElement).value,
                      })}
                  />
                `
              : nothing}
            ${renderSettingsSecretInput({
              ariaLabel: `${provider.label} ${t("myApiKeysPage.apiKey")}`,
              value: draft.apiKey,
              placeholder: saved
                ? t("myApiKeysPage.apiKeyReplacePlaceholder")
                : provider.keyHint || t("myApiKeysPage.apiKeyPlaceholder"),
              visible: draft.visible,
              showLabel: t("myApiKeysPage.showKey"),
              hideLabel: t("myApiKeysPage.hideKey"),
              toggleLabel: t("myApiKeysPage.toggleKey"),
              onInput: (next) => this.updateDraft(provider.id, { apiKey: next }),
              onToggle: () => this.updateDraft(provider.id, { visible: !draft.visible }),
            })}
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="submit" class="btn btn--sm primary" ?disabled=${!canSave}>
                ${busy === "save" ? t("myApiKeysPage.saving") : t("myApiKeysPage.save")}
              </button>
              ${saved
                ? html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${Boolean(busy)}
                      @click=${() => this.test(provider)}
                    >
                      ${busy === "test" ? t("myApiKeysPage.testing") : t("myApiKeysPage.test")}
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm danger"
                      ?disabled=${Boolean(busy)}
                      @click=${() => this.remove(provider)}
                    >
                      ${busy === "remove" ? t("myApiKeysPage.removing") : t("myApiKeysPage.remove")}
                    </button>
                  `
                : nothing}
            </div>
          </form>
        `,
      })}
    `;
  }

  private renderBody() {
    if (resolveOpenClawAudience() !== "aimarkets") {
      return renderSettingsPage(renderSettingsEmpty(t("myApiKeysPage.notAimarkets")));
    }
    if (this.loading) {
      return renderSettingsPage(renderSettingsEmpty(t("myApiKeysPage.loading")));
    }
    if (this.loadError) {
      return renderSettingsPage(html`
        ${renderSettingsEmpty(t("myApiKeysPage.loadFailed", { error: this.loadError }))}
        <button type="button" class="btn btn--sm" @click=${() => void this.load()}>
          ${t("myApiKeysPage.retry")}
        </button>
      `);
    }
    if (this.ticketMissing) {
      return renderSettingsPage(
        renderSettingsSection(
          { title: t("myApiKeysPage.noTicketTitle") },
          renderSettingsEmpty(html`${t("myApiKeysPage.noTicketBody")}
          ${renderDocsLink("https://aimarkets.vn", "aimarkets.vn")}`),
        ),
        { intro: t("myApiKeysPage.intro") },
      );
    }
    return renderSettingsPage(
      renderSettingsSection(
        {
          title: t("myApiKeysPage.providersTitle"),
          description: t("myApiKeysPage.providersDescription"),
          count: Object.keys(this.keys).length,
        },
        this.providers.map((provider) => this.renderProvider(provider)),
      ),
      { intro: t("myApiKeysPage.intro") },
    );
  }

  override render() {
    return html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("my-api-keys")}</div>
        </div>
      </section>
      ${renderSettingsWorkspace(this.renderBody())}
    `;
  }
}

if (!customElements.get("openclaw-my-api-keys-page")) {
  customElements.define("openclaw-my-api-keys-page", MyApiKeysPage);
}
