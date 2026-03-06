import { describe, expect, it, vi } from "vitest";
import { wizardHandlers } from "./wizard.js";
import type { GatewayRequestHandlerOptions } from "./types.js";
import type { WizardNextResult } from "../../wizard/session.js";

function createOptions(overrides?: Partial<GatewayRequestHandlerOptions>): GatewayRequestHandlerOptions {
  const context = {
    wizardSessions: new Map(),
    findRunningWizard: () => null,
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
      findRunningWizard: () => "existing-session",
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
});
