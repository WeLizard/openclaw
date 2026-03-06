import type { GatewayBrowserClient } from "../gateway.ts";
import type { WizardNextResult, WizardStartResult, WizardStep } from "../types.ts";
import { i18n } from "../../i18n/index.ts";

export type SetupWizardMode = "local" | "remote";
export type SetupWizardStatus = WizardStartResult["status"] | null;
export type SetupWizardIntent = "onboarding" | "models-auth-login";

export type StartSetupWizardOptions = {
  intent?: SetupWizardIntent;
  provider?: string | null;
  oauthOnly?: boolean;
};

export type SetupWizardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  wizardOpen: boolean;
  wizardLoading: boolean;
  wizardBusy: boolean;
  wizardMode: SetupWizardMode;
  wizardIntent: SetupWizardIntent;
  wizardContextLabel: string | null;
  wizardSessionId: string | null;
  wizardStatus: SetupWizardStatus;
  wizardError: string | null;
  wizardStep: WizardStep | null;
  wizardDraftValue: unknown;
  loadOverview?: () => Promise<void>;
};

type PersistedSetupWizardState = {
  sessionId: string;
  mode: SetupWizardMode;
  intent: SetupWizardIntent;
  contextLabel: string | null;
};

const SETUP_WIZARD_STORAGE_KEY = "openclaw.control.setupWizard.v1";

function readPersistedSetupWizardState(): PersistedSetupWizardState | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(SETUP_WIZARD_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PersistedSetupWizardState;
    if (
      !parsed ||
      typeof parsed.sessionId !== "string" ||
      (parsed.mode !== "local" && parsed.mode !== "remote") ||
      (parsed.intent !== "onboarding" && parsed.intent !== "models-auth-login")
    ) {
      localStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      mode: parsed.mode,
      intent: parsed.intent,
      contextLabel: typeof parsed.contextLabel === "string" ? parsed.contextLabel : null,
    };
  } catch {
    localStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
    return null;
  }
}

function persistSetupWizardState(state: SetupWizardState) {
  if (typeof localStorage === "undefined" || !state.wizardSessionId) {
    return;
  }
  const payload: PersistedSetupWizardState = {
    sessionId: state.wizardSessionId,
    mode: state.wizardMode,
    intent: state.wizardIntent,
    contextLabel: state.wizardContextLabel,
  };
  localStorage.setItem(SETUP_WIZARD_STORAGE_KEY, JSON.stringify(payload));
}

function clearPersistedSetupWizardState() {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
}

function resolveInitialDraft(step: WizardStep | null): unknown {
  if (!step) {
    return null;
  }
  if (step.type === "confirm") {
    return Boolean(step.initialValue);
  }
  if (step.type === "multiselect") {
    return Array.isArray(step.initialValue) ? step.initialValue : [];
  }
  if (step.type === "select") {
    if (step.initialValue !== undefined) {
      return step.initialValue;
    }
    return step.options?.[0]?.value ?? null;
  }
  if (step.type === "text") {
    return typeof step.initialValue === "string" ? step.initialValue : "";
  }
  return null;
}

function applyWizardResult(
  state: SetupWizardState,
  result: WizardStartResult | WizardNextResult,
  sessionId?: string | null,
) {
  state.wizardOpen = true;
  state.wizardLoading = false;
  state.wizardBusy = false;
  state.wizardStatus = result.status ?? (result.done ? "done" : "running");
  state.wizardError = result.error ?? null;
  state.wizardSessionId = result.done ? null : (sessionId ?? state.wizardSessionId);
  state.wizardStep = result.done ? null : (result.step ?? null);
  state.wizardDraftValue = resolveInitialDraft(state.wizardStep);
  if (result.done || state.wizardStatus !== "running" || !state.wizardSessionId) {
    clearPersistedSetupWizardState();
  } else {
    persistSetupWizardState(state);
  }
  if (result.done) {
    void state.loadOverview?.();
  }
}

function resetWizardState(state: SetupWizardState) {
  state.wizardOpen = false;
  state.wizardLoading = false;
  state.wizardBusy = false;
  state.wizardIntent = "onboarding";
  state.wizardContextLabel = null;
  state.wizardSessionId = null;
  state.wizardStatus = null;
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
}

async function resumePersistedSetupWizard(state: SetupWizardState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const persisted = readPersistedSetupWizardState();
  if (!persisted) {
    return false;
  }
  state.wizardOpen = true;
  state.wizardLoading = true;
  state.wizardBusy = false;
  state.wizardMode = persisted.mode;
  state.wizardIntent = persisted.intent;
  state.wizardContextLabel = persisted.contextLabel;
  state.wizardSessionId = persisted.sessionId;
  state.wizardStatus = "running";
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
  try {
    const result = await state.client.request<WizardNextResult>("wizard.next", {
      sessionId: persisted.sessionId,
    });
    applyWizardResult(state, result, persisted.sessionId);
    return true;
  } catch (err) {
    clearPersistedSetupWizardState();
    resetWizardState(state);
    state.wizardError = String(err);
    state.wizardStatus = "error";
    return false;
  }
}

export function updateSetupWizardDraft(state: SetupWizardState, value: unknown) {
  state.wizardDraftValue = value;
}

export function dismissSetupWizard(state: SetupWizardState) {
  resetWizardState(state);
}

export async function startSetupWizard(
  state: SetupWizardState,
  mode: SetupWizardMode,
  options?: StartSetupWizardOptions,
) {
  if (!state.client || !state.connected || state.wizardLoading || state.wizardBusy) {
    return;
  }
  const restored = await resumePersistedSetupWizard(state);
  if (restored) {
    return;
  }
  const providerLabel =
    typeof options?.provider === "string" ? options.provider.trim() : "";
  const contextParts = [providerLabel];
  if (options?.oauthOnly) {
    contextParts.push("oauth");
  }
  state.wizardOpen = true;
  state.wizardLoading = true;
  state.wizardBusy = false;
  state.wizardMode = mode;
  state.wizardIntent = options?.intent ?? "onboarding";
  state.wizardContextLabel = contextParts.filter(Boolean).join(" · ") || null;
  state.wizardSessionId = null;
  state.wizardStatus = "running";
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
  try {
    const result = await state.client.request<WizardStartResult>("wizard.start", {
      mode,
      intent: options?.intent ?? "onboarding",
      ...(providerLabel ? { provider: providerLabel } : {}),
      ...(options?.oauthOnly !== undefined ? { oauthOnly: options.oauthOnly } : {}),
      locale: i18n.getLocale(),
    });
    applyWizardResult(state, result, result.sessionId ?? null);
  } catch (err) {
    if (String(err).includes("wizard already running")) {
      const recovered = await resumePersistedSetupWizard(state);
      if (recovered) {
        return;
      }
    }
    state.wizardLoading = false;
    state.wizardError = String(err);
    state.wizardStatus = "error";
  }
}

export async function submitSetupWizard(state: SetupWizardState) {
  if (!state.client || !state.connected || !state.wizardSessionId || !state.wizardStep) {
    return;
  }
  if (state.wizardLoading || state.wizardBusy) {
    return;
  }
  state.wizardBusy = true;
  state.wizardError = null;
  const requiresAnswer =
    state.wizardStep.type !== "note" &&
    state.wizardStep.type !== "progress" &&
    state.wizardStep.type !== "action";
  try {
    const result = await state.client.request<WizardNextResult>("wizard.next", {
      sessionId: state.wizardSessionId,
      answer: {
        stepId: state.wizardStep.id,
        value: requiresAnswer ? state.wizardDraftValue : null,
      },
    });
    applyWizardResult(state, result);
  } catch (err) {
    state.wizardBusy = false;
    state.wizardError = String(err);
    state.wizardStatus = "error";
  }
}

export async function cancelSetupWizard(state: SetupWizardState) {
  if (state.client && state.connected && state.wizardSessionId) {
    try {
      await state.client.request("wizard.cancel", { sessionId: state.wizardSessionId });
    } catch {
      // Ignore cancellation transport errors; local state still needs to clear.
    }
  }
  clearPersistedSetupWizardState();
  resetWizardState(state);
}
