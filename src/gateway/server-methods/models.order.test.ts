import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(),
  resolveAuthProfileOrder: vi.fn(),
  setAuthProfileOrder: vi.fn(),
  getModelsAuthStatus: vi.fn(),
}));

vi.mock("../../agents/auth-profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/auth-profiles.js")>();
  return {
    ...actual,
    ensureAuthProfileStore: mocks.ensureAuthProfileStore,
    resolveAuthProfileOrder: mocks.resolveAuthProfileOrder,
    setAuthProfileOrder: mocks.setAuthProfileOrder,
  };
});

vi.mock("../../commands/models/auth-status.js", () => ({
  getModelsAuthStatus: mocks.getModelsAuthStatus,
}));

const { modelsHandlers } = await import("./models.js");

function createStatus() {
  return {
    agentId: "main",
    agentDir: "/tmp/openclaw/agents/main",
    authStorePath: "/tmp/openclaw/agents/main/auth-profiles.json",
    inUseProviders: ["qwen-portal"],
    missingProvidersInUse: [],
    providers: [
      {
        provider: "qwen-portal",
        status: "ok",
        inUse: true,
        effective: { kind: "profiles", detail: "/tmp/openclaw/agents/main/auth-profiles.json" },
        counts: {
          total: 2,
          oauth: 2,
          token: 0,
          apiKey: 0,
          available: 2,
          unavailable: 0,
        },
        activeProfileId: "qwen-portal:default",
        lastGoodProfileId: null,
        storedOrder: ["qwen-portal:default", "qwen-portal:work"],
        configuredOrder: null,
        currentOrder: ["qwen-portal:default", "qwen-portal:work"],
        orderSource: "stored",
        hasStoredOrderOverride: true,
        profiles: [
          {
            profileId: "qwen-portal:default",
            label: "qwen-portal:default",
            provider: "qwen-portal",
            type: "oauth",
            healthStatus: "ok",
            unusableKind: "available",
            inStoredOrder: true,
            isCurrent: true,
            isLastGood: false,
          },
          {
            profileId: "qwen-portal:work",
            label: "qwen-portal:work",
            provider: "qwen-portal",
            type: "oauth",
            healthStatus: "ok",
            unusableKind: "available",
            inStoredOrder: true,
            isCurrent: false,
            isLastGood: false,
          },
        ],
      },
    ],
  };
}

describe("modelsHandlers models.auth.order.move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAuthProfileStore.mockReturnValue({ profiles: {}, order: {} });
    mocks.resolveAuthProfileOrder.mockReturnValue(["qwen-portal:default", "qwen-portal:work"]);
    const status = createStatus();
    mocks.getModelsAuthStatus.mockReturnValue(status);
    mocks.setAuthProfileOrder.mockResolvedValue(true);
  });

  it("moves a profile up in the stored provider order", async () => {
    const respond = vi.fn();

    await modelsHandlers["models.auth.order.move"]({
      params: {
        provider: "qwen-portal",
        profileId: "qwen-portal:work",
        direction: "up",
      },
      respond,
    } as never);

    expect(mocks.setAuthProfileOrder).toHaveBeenCalledWith({
      agentDir: "/tmp/openclaw/agents/main",
      provider: "qwen-portal",
      order: ["qwen-portal:work", "qwen-portal:default"],
    });
    expect(respond).toHaveBeenCalledWith(true, createStatus(), undefined);
  });

  it("returns current status without writing when the profile is already first", async () => {
    const respond = vi.fn();
    const status = createStatus();
    mocks.getModelsAuthStatus.mockReturnValue(status);

    await modelsHandlers["models.auth.order.move"]({
      params: {
        provider: "qwen-portal",
        profileId: "qwen-portal:default",
        direction: "up",
      },
      respond,
    } as never);

    expect(mocks.setAuthProfileOrder).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, status, undefined);
  });
});
