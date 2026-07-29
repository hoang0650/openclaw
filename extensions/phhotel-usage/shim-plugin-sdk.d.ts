/** Local ambient types so IDE can check this extension without a full openclaw build. */

/** Structured decision returned by gate hooks such as before_agent_run. */
type PhhotelUsageInputGateDecision =
  | { outcome: "pass" }
  | {
      outcome: "block";
      reason: string;
      message?: string;
      category?: string;
      metadata?: Record<string, unknown>;
    };

type PhhotelUsageHookResult = void | PhhotelUsageInputGateDecision;

declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawPluginApi = {
    pluginConfig?: Record<string, unknown>;
    logger?: { info?: (message: string) => void; warn?: (message: string) => void };
    on: (
      hookName: string,
      handler: (event: any, ctx: any) => PhhotelUsageHookResult | Promise<PhhotelUsageHookResult>,
    ) => void;
  };

  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description?: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
