/** Local ambient types so IDE can check this extension without a full openclaw build. */
declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawPluginApi = {
    pluginConfig?: Record<string, unknown>;
    logger?: { info?: (message: string) => void; warn?: (message: string) => void };
    on: (hookName: string, handler: (event: any, ctx: any) => void | Promise<void>) => void;
  };

  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description?: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
