import { describe, expect, it, vi } from "vitest";
import { wizardHandlers } from "./wizard.js";
import type { GatewayRequestHandlerOptions } from "./types.js";
import type { WizardNextResult } from "../../wizard/session.js";
import type { WizardSessionMetadata } from "../server-wizard-sessions.js";

function createOptions(overrides?: Partial<GatewayRequestHandlerOptions>): GatewayRequestHandlerOptions {
  const context = {
    wizardSessions: new Map(),
    registerWizardSession: vi.fn((id: string, session: unknown) => {
      context.wizardSessions.set(id, session as never);
    }),
    getWizardSessionMetadata: () => null,
    findRunningWizard: () => null,
    deleteWizardSession: vi.fn((id: string) => {
      context.wizardSessions.delete(id);
    }),
    purgeWizardSession: vi.fn(),
    wizardRunner: vi.fn(),
  } as unknown as GatewayRequestHandlerOptions["context"];
  return {
    req: { type: "req", id: "test", method: "wizard.start", params: {} },
    params: {},
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context,
    ...overrides,
  };
}

describe("wizardHandlers", () => {
  it("reattaches to an already running wizard instead of failing", async () => {
    const nextResult: WizardNextResult = {
      done: false,
      status: "running",
      step: {
        id: "step-1",
        type: "note",
        title: "Title",
        message: "Message",
      },
    };
    const runningSession = {
      getStatus: () => "running",
      next: vi.fn(async () => nextResult),
    } as unknown as GatewayRequestHandlerOptions["context"]["wizardSessions"] extends Map<
      string,
      infer T
    >
      ? T
      : never;
    const context = {
      wizardSessions: new Map([["existing-session", runningSession]]),
      registerWizardSession: vi.fn(),
      getWizardSessionMetadata: () => ({
        mode: "local",
        intent: "onboarding",
        provider: null,
        oauthOnly: false,
      }),
      findRunningWizard: vi.fn(() => "existing-session"),
      deleteWizardSession: vi.fn(),
      purgeWizardSession: vi.fn(),
      wizardRunner: vi.fn(),
    } as unknown as GatewayRequestHandlerOptions["context"];
    const respond = vi.fn();
    const options = createOptions({
      params: { mode: "local" },
      respond,
      context,
    });

    await wizardHandlers["wizard.start"](options);

    expect(runningSession.next).toHaveBeenCalledTimes(1);
    expect(context.findRunningWizard).toHaveBeenCalledWith({
      mode: "local",
      intent: "onboarding",
      provider: null,
      oauthOnly: false,
    } satisfies WizardSessionMetadata);
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        sessionId: "existing-session",
        ...nextResult,
      },
      undefined,
    );
    expect(context.purgeWizardSession).not.toHaveBeenCalled();
  });

  it("starts a new wizard when a different flow is already running", async () => {
    const registerWizardSession = vi.fn((id: string, session: unknown) => {
      context.wizardSessions.set(id, session as never);
    });
    const context = {
      wizardSessions: new Map(),
      registerWizardSession,
      getWizardSessionMetadata: () => null,
      findRunningWizard: vi.fn(() => null),
      deleteWizardSession: vi.fn(),
      purgeWizardSession: vi.fn(),
      wizardRunner: vi.fn(async (_opts, _runtime, prompter) => {
        await prompter.note("Auth step", "Provider auth");
      }),
    } as unknown as GatewayRequestHandlerOptions["context"];
    const respond = vi.fn();
    const options = createOptions({
      params: {
        mode: "local",
        intent: "models-auth-login",
        provider: "qwen-portal",
        oauthOnly: true,
      },
      respond,
      context,
    });

    await wizardHandlers["wizard.start"](options);

    expect(context.findRunningWizard).toHaveBeenCalledWith({
      mode: "local",
      intent: "models-auth-login",
      provider: "qwen-portal",
      oauthOnly: true,
    } satisfies WizardSessionMetadata);
    expect(registerWizardSession).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        done: false,
        status: "running",
        step: expect.objectContaining({
          type: "note",
          title: "Provider auth",
          message: "Auth step",
        }),
      }),
      undefined,
    );
  });
});
