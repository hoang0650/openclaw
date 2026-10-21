import { describe, expect, it } from "vitest";
import { tenantGatewayToken, tenantIdFromHost } from "./tenant-gateway-token.js";

describe("tenant gateway token", () => {
  it("matches PHGroup-AI HMAC-SHA256 base64url", () => {
    expect(
      tenantGatewayToken("6a69f0cdd7faa829b87a852e", {
        PYTHON_AI_SHARED_SECRET: "phhotel_openclaw_secret",
      }),
    ).toBe("iLUpV0BI4rjslxurodwlY1rY-mbMyWtSZkO09b7fkTA");
  });

  it("uses the host label and ignores another tenant", () => {
    const env = { NEST_SERVICE_AUTH_SECRET: "shared-seed" };
    const hotel = tenantIdFromHost("6a69f0cdd7faa829b87a852e.phhotel.vn:443");
    const buyer = tenantIdFromHost(
      "6a69f0cdd7faa829b87a852e.openclaw.aimarkets.vn, proxy.internal",
    );
    expect(hotel).toBe("6a69f0cdd7faa829b87a852e");
    expect(buyer).toBe(hotel);
    expect(tenantGatewayToken(hotel, env)).not.toBe(
      tenantGatewayToken("0123456789abcdef01234567", env),
    );
    expect(tenantIdFromHost("openclaw.aimarkets.vn")).toBeUndefined();
  });
});
