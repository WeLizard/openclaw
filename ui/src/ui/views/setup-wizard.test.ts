/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { renderSetupWizard } from "./setup-wizard.ts";

function createState(overrides: Partial<AppViewState> = {}): AppViewState {
  return {
    wizardOpen: true,
    wizardLoading: false,
    wizardBusy: false,
    wizardMode: "local",
    wizardIntent: "models-auth-login",
    wizardProvider: "qwen-portal",
    wizardOauthOnly: true,
    wizardContextLabel: "qwen-portal",
    wizardSessionId: "session-1",
    wizardStatus: "running",
    wizardError: null,
    wizardStep: {
      id: "oauth-note",
      type: "note",
      title: "Qwen OAuth",
      message:
        "Open https://chat.qwen.ai/authorize?user_code=IMW85XFW&client=qwen-code to approve access.",
    },
    wizardDraftValue: null,
    handleSubmitSetupWizard: async () => undefined,
    handleCancelSetupWizard: async () => undefined,
    handleDismissSetupWizard: () => undefined,
    handleUpdateSetupWizardDraft: () => undefined,
    ...overrides,
  } as AppViewState;
}

describe("renderSetupWizard", () => {
  it("renders links inside wizard note messages", async () => {
    await i18n.setLocale("en");
    const container = document.createElement("div");

    render(renderSetupWizard(createState()), container);

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href^="https://chat.qwen.ai/authorize"]',
    );
    expect(link).not.toBeNull();
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noopener");
    expect(link?.textContent).toContain("https://chat.qwen.ai/authorize");
  });
});
