import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectErrorDetailCodes } from "../../../../src/gateway/protocol/connect-error-details.js";
import { shouldShowPairingHint } from "./overview-hints.ts";
import type { ModelsAuthProviderStatus } from "../types.ts";

describe("shouldShowPairingHint", () => {
  it("returns true for 'pairing required' close reason", () => {
    expect(shouldShowPairingHint(false, "disconnected (1008): pairing required")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(shouldShowPairingHint(false, "Pairing Required")).toBe(true);
  });

  it("returns false when connected", () => {
    expect(shouldShowPairingHint(true, "disconnected (1008): pairing required")).toBe(false);
  });

  it("returns false when lastError is null", () => {
    expect(shouldShowPairingHint(false, null)).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(shouldShowPairingHint(false, "disconnected (1006): no reason")).toBe(false);
  });

  it("returns false for auth errors", () => {
    expect(shouldShowPairingHint(false, "disconnected (4008): unauthorized")).toBe(false);
  });

  it("returns true for structured pairing code", () => {
    expect(
      shouldShowPairingHint(
        false,
        "disconnected (4008): connect failed",
        ConnectErrorDetailCodes.PAIRING_REQUIRED,
      ),
    ).toBe(true);
  });
});

describe("resolveDisplayedProviderStatus", () => {
  let resolveDisplayedProviderStatus: typeof import("./overview.ts").resolveDisplayedProviderStatus;

  beforeEach(async () => {
    const storage = {
      getItem: () => "en",
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    vi.stubGlobal("localStorage", storage);
    ({ resolveDisplayedProviderStatus } = await import("./overview.ts"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("treats profile-backed API key providers as healthy in the UI", () => {
    const entry = {
      provider: "cliproxy",
      status: "static",
      inUse: true,
      effective: { kind: "profiles", detail: "/config/.openclaw/agents/main/agent/auth-profiles.json" },
      counts: { total: 1, oauth: 0, token: 0, apiKey: 1, available: 1, unavailable: 0 },
      activeProfileId: "cliproxy:default",
      lastGoodProfileId: null,
      storedOrder: null,
      configuredOrder: null,
      currentOrder: ["cliproxy:default"],
      orderSource: "derived",
      hasStoredOrderOverride: false,
      profiles: [
        {
          profileId: "cliproxy:default",
          label: "cliproxy:default",
          provider: "cliproxy",
          type: "api_key",
          healthStatus: "static",
          unusableKind: "available",
          inStoredOrder: false,
          isCurrent: true,
          isLastGood: false,
        },
      ],
    } satisfies ModelsAuthProviderStatus;

    expect(resolveDisplayedProviderStatus(entry)).toBe("ok");
  });

  it("keeps legacy static providers marked as static", () => {
    const entry = {
      provider: "legacy",
      status: "static",
      inUse: false,
      effective: { kind: "models.json", detail: "/config/.openclaw/agents/main/agent/models.json" },
      counts: { total: 0, oauth: 0, token: 0, apiKey: 0, available: 0, unavailable: 0 },
      activeProfileId: null,
      lastGoodProfileId: null,
      storedOrder: null,
      configuredOrder: null,
      currentOrder: [],
      orderSource: "derived",
      hasStoredOrderOverride: false,
      profiles: [],
    } satisfies ModelsAuthProviderStatus;

    expect(resolveDisplayedProviderStatus(entry)).toBe("static");
  });
});
