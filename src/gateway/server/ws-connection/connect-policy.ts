import type { ConnectParams } from "../../../../packages/gateway-protocol/src/index.js";
import { roleCanSkipDeviceIdentity } from "../../role-policy.js";
import type { GatewayRole } from "../../role-policy.types.js";

export type ControlUiPairingKind = "tailscale-device" | "aimarkets-ticket" | "auth-none" | null;

export function shouldSkipControlUiPairing(params: {
  isControlUi: boolean;
  device: ConnectParams["device"] | null | undefined;
  role: GatewayRole;
  authMode?: string;
  authMethod?: string;
  /**
   * Fork (AI Markets): caller verified ticket enforcement is on, the host is an
   * aimarkets host and the upgrade carries a valid signed aimt ticket.
   */
  aimarketsTicketVerified?: boolean;
}): ControlUiPairingKind {
  if (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMethod === "tailscale" &&
    params.device
  ) {
    return "tailscale-device";
  }
  // AI Markets buyers launch the Control UI with the derived shared token plus a
  // signed per-buyer ticket; that ticket is the device/owner proof. Like the
  // tailscale case this only waives first-time pairing for a presented device;
  // known devices still go through the normal paired-device checks.
  if (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMethod === "token" &&
    params.aimarketsTicketVerified === true &&
    params.device
  ) {
    return "aimarkets-ticket";
  }
  // When auth is completely disabled (mode=none), there is no shared secret
  // or token to gate pairing. Requiring pairing in this configuration adds
  // friction without security value since any client can already connect
  // without credentials. Guard with isControlUi because this function is
  // called for ALL clients (not just Control UI) at the call site.
  // Scope to operator role so node-role sessions still need device identity
  // (#43478 was reverted for skipping ALL clients).
  if (params.isControlUi && params.role === "operator" && params.authMode === "none") {
    return "auth-none";
  }
  return null;
}

export function isTrustedProxyControlUiOperatorAuth(params: {
  isControlUi: boolean;
  role: GatewayRole;
  authMode: string;
  authOk: boolean;
  authMethod: string | undefined;
}): boolean {
  return (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMode === "trusted-proxy" &&
    params.authOk &&
    params.authMethod === "trusted-proxy"
  );
}

type MissingDeviceIdentityDecision =
  | { kind: "allow" }
  | { kind: "reject-control-ui-insecure-auth" }
  | { kind: "reject-unauthorized" }
  | { kind: "reject-device-required" };

export function shouldClearUnboundScopesForMissingDeviceIdentity(params: {
  decision: MissingDeviceIdentityDecision;
  authMethod: string | undefined;
}): boolean {
  return (
    params.decision.kind !== "allow" ||
    params.authMethod === "token" ||
    params.authMethod === "password" ||
    params.authMethod === "trusted-proxy"
  );
}

export function evaluateMissingDeviceIdentity(params: {
  hasDeviceIdentity: boolean;
  role: GatewayRole;
  isControlUi: boolean;
  trustedProxyAuthOk?: boolean;
  localBackendSelfPairingOk?: boolean;
  sharedAuthOk: boolean;
  authOk: boolean;
  hasSharedAuth: boolean;
}): MissingDeviceIdentityDecision {
  if (params.hasDeviceIdentity) {
    return { kind: "allow" };
  }
  if (params.isControlUi && params.trustedProxyAuthOk) {
    return { kind: "allow" };
  }
  if (params.localBackendSelfPairingOk && params.role === "operator") {
    return { kind: "allow" };
  }
  if (params.isControlUi) {
    return { kind: "reject-control-ui-insecure-auth" };
  }
  if (roleCanSkipDeviceIdentity(params.role, params.sharedAuthOk)) {
    return { kind: "allow" };
  }
  if (!params.authOk && params.hasSharedAuth) {
    return { kind: "reject-unauthorized" };
  }
  return { kind: "reject-device-required" };
}
