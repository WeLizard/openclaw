import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupWizardState } from "./setup-wizard.ts";

type StorageStub = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createStorage(): StorageStub {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  };
}

function createState(request: (method: string, params?: unknown) => Promise<unknown>): SetupWizardState {
  return {
    client: { request } as unknown as SetupWizardState["client"],
    connected: true,
    wizardOpen: false,
    wizardLoading: false,
    wizardBusy: false,
    wizardMode: "local",
    wizardIntent: "onboarding",
    wizardProvider: null,
    wizardOauthOnly: false,
    wizardContextLabel: null,
    wizardSessionId: null,
    wizardStatus: null,
    wizardError: null,
    wizardStep: null,
    wizardDraftValue: null,
  };
}

const STORAGE_KEY = "openclaw.control.setupWizard.v1";

describe("setup wizard controller", () => {
  let storage: StorageStub;
  let startSetupWizard: typeof import("./setup-wizard.ts").startSetupWizard;
  let submitSetupWizard: typeof import("./setup-wizard.ts").submitSetupWizard;

  beforeEach(async () => {
    storage = createStorage();
    vi.stubGlobal("localStorage", storage);
    ({ startSetupWizard, submitSetupWizard } = await import("./setup-wizard.ts"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not resume a persisted wizard from a different flow", async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: "persisted-auth",
        mode: "local",
        intent: "models-auth-login",
        provider: "qwen-portal",
        oauthOnly: true,
        contextLabel: "qwen-portal · oauth",
      }),
    );

    const request = vi.fn(async (method: string) => {
      if (method === "wizard.start") {
        return {
          sessionId: "new-local-session",
          done: false,
          status: "running",
          step: {
            id: "step-1",
            type: "note",
            title: "OpenClaw onboarding",
            message: "Fresh local wizard",
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState(request);

    await startSetupWizard(state, "local");

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "wizard.start",
      expect.objectContaining({
        mode: "local",
        intent: "onboarding",
      }),
    );
    expect(state.wizardSessionId).toBe("new-local-session");
    expect(state.wizardIntent).toBe("onboarding");
  });

  it("resumes a persisted wizard only when the requested flow matches", async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: "persisted-auth",
        mode: "local",
        intent: "models-auth-login",
        provider: "qwen-portal",
        oauthOnly: true,
        contextLabel: "qwen-portal · oauth",
      }),
    );

    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "wizard.next") {
        const typedParams = params as { sessionId?: string } | undefined;
        return {
          done: false,
          status: "running",
          step: {
            id: "step-2",
            type: "note",
            title: "Provider auth",
            message: `Resumed ${typedParams?.sessionId}`,
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState(request);

    await startSetupWizard(state, "local", {
      intent: "models-auth-login",
      provider: "qwen-portal",
      oauthOnly: true,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("wizard.next", { sessionId: "persisted-auth" });
    expect(state.wizardSessionId).toBe("persisted-auth");
    expect(state.wizardIntent).toBe("models-auth-login");
    expect(state.wizardProvider).toBe("qwen-portal");
    expect(state.wizardOauthOnly).toBe(true);
  });

  it("starts provider auth without forcing a provider id", async () => {
    const request = vi.fn(async (...args: unknown[]) => {
      const method = args[0] as string;
      if (method === "wizard.start") {
        return {
          sessionId: "provider-auth-session",
          done: false,
          status: "running",
          step: {
            id: "provider-group",
            type: "select",
            title: "Provider auth",
            message: "Choose a provider",
            options: [],
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState(request);

    await startSetupWizard(state, "local", { intent: "models-auth-login" });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "wizard.start",
      expect.objectContaining({
        mode: "local",
        intent: "models-auth-login",
      }),
    );
    const startParams = request.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(startParams?.provider).toBeUndefined();
    expect(state.wizardIntent).toBe("models-auth-login");
    expect(state.wizardProvider).toBeNull();
  });

  it("closes a final note step when the wizard session disappears after save", async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: "cliproxy-auth",
        mode: "local",
        intent: "models-auth-login",
        provider: "cliproxy",
        oauthOnly: false,
        contextLabel: "cliproxy",
      }),
    );

    const request = vi.fn(async (method: string) => {
      if (method === "wizard.next") {
        throw new Error("GatewayRequestError: wizard not found");
      }
      throw new Error(`unexpected ${method}`);
    });
    const loadOverview = vi.fn(async () => {});
    const state = createState(request);
    state.wizardOpen = true;
    state.wizardSessionId = "cliproxy-auth";
    state.wizardStatus = "running";
    state.wizardIntent = "models-auth-login";
    state.wizardProvider = "cliproxy";
    state.wizardContextLabel = "cliproxy";
    state.wizardStep = {
      id: "custom-provider-done",
      type: "note",
      title: "Done",
      message: "Provider saved",
    };
    state.loadOverview = loadOverview;

    await submitSetupWizard(state);

    expect(request).toHaveBeenCalledWith("wizard.next", {
      sessionId: "cliproxy-auth",
      answer: {
        stepId: "custom-provider-done",
        value: null,
      },
    });
    expect(state.wizardOpen).toBe(false);
    expect(state.wizardSessionId).toBeNull();
    expect(state.wizardStatus).toBeNull();
    expect(state.wizardError).toBeNull();
    expect(loadOverview).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
