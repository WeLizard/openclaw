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
  wizardProvider: string | null;
  wizardOauthOnly: boolean;
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
  provider: string | null;
  oauthOnly: boolean;
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
      provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider : null,
      oauthOnly: parsed.oauthOnly === true,
      contextLabel: typeof parsed.contextLabel === "string" ? parsed.contextLabel : null,
    };
  } catch {
    localStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
    return null;
  }
}

function normalizeProvider(provider: string | null | undefined): string | null {
  const value = typeof provider === "string" ? provider.trim() : "";
  return value ? value : null;
}

function resolveWizardRequest(
  mode: SetupWizardMode,
  options?: StartSetupWizardOptions,
): {
  mode: SetupWizardMode;
  intent: SetupWizardIntent;
  provider: string | null;
  oauthOnly: boolean;
  contextLabel: string | null;
} {
  const provider = normalizeProvider(options?.provider);
  const oauthOnly = options?.oauthOnly === true;
  const contextParts = [provider];
  if (oauthOnly) {
    contextParts.push("oauth");
  }
  return {
    mode,
    intent: options?.intent ?? "onboarding",
    provider,
    oauthOnly,
    contextLabel: contextParts.filter(Boolean).join(" · ") || null,
  };
}

function matchesPersistedWizardRequest(
  persisted: PersistedSetupWizardState,
  requested: ReturnType<typeof resolveWizardRequest>,
): boolean {
  return (
    persisted.mode === requested.mode &&
    persisted.intent === requested.intent &&
    normalizeProvider(persisted.provider) === requested.provider &&
    Boolean(persisted.oauthOnly) === requested.oauthOnly
  );
}

function persistSetupWizardState(state: SetupWizardState) {
  if (typeof localStorage === "undefined" || !state.wizardSessionId) {
    return;
  }
  const payload: PersistedSetupWizardState = {
    sessionId: state.wizardSessionId,
    mode: state.wizardMode,
    intent: state.wizardIntent,
    provider: normalizeProvider(state.wizardProvider),
    oauthOnly: state.wizardOauthOnly === true,
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

function isWizardNotFoundError(err: unknown): boolean {
  return String(err).toLowerCase().includes("wizard not found");
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
  state.wizardProvider = null;
  state.wizardOauthOnly = false;
  state.wizardContextLabel = null;
  state.wizardSessionId = null;
  state.wizardStatus = null;
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
}

async function resumePersistedSetupWizard(
  state: SetupWizardState,
  requested?: ReturnType<typeof resolveWizardRequest>,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const persisted = readPersistedSetupWizardState();
  if (!persisted) {
    return false;
  }
  if (requested && !matchesPersistedWizardRequest(persisted, requested)) {
    return false;
  }
  state.wizardOpen = true;
  state.wizardLoading = true;
  state.wizardBusy = false;
  state.wizardMode = persisted.mode;
  state.wizardIntent = persisted.intent;
  state.wizardProvider = persisted.provider;
  state.wizardOauthOnly = persisted.oauthOnly;
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
  const requested = resolveWizardRequest(mode, options);
  const restored = await resumePersistedSetupWizard(state, requested);
  if (restored) {
    return;
  }
  state.wizardOpen = true;
  state.wizardLoading = true;
  state.wizardBusy = false;
  state.wizardMode = requested.mode;
  state.wizardIntent = requested.intent;
  state.wizardProvider = requested.provider;
  state.wizardOauthOnly = requested.oauthOnly;
  state.wizardContextLabel = requested.contextLabel;
  state.wizardSessionId = null;
  state.wizardStatus = "running";
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
  try {
    const result = await state.client.request<WizardStartResult>("wizard.start", {
      mode: requested.mode,
      intent: requested.intent,
      ...(requested.provider ? { provider: requested.provider } : {}),
      ...(options?.oauthOnly !== undefined ? { oauthOnly: requested.oauthOnly } : {}),
      locale: i18n.getLocale(),
    });
    applyWizardResult(state, result, result.sessionId ?? null);
  } catch (err) {
    if (String(err).includes("wizard already running")) {
      const recovered = await resumePersistedSetupWizard(state, requested);
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
    if (state.wizardStep.type === "note" && isWizardNotFoundError(err)) {
      clearPersistedSetupWizardState();
      resetWizardState(state);
      void state.loadOverview?.();
      return;
    }
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
