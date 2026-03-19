import type { OnboardMode } from "../commands/onboard-types.js";
import type { WizardSession } from "../wizard/session.js";

export type WizardSessionIntent = "onboarding" | "models-auth-login";

export type WizardSessionMetadata = {
  mode: OnboardMode;
  intent: WizardSessionIntent;
  provider: string | null;
  oauthOnly: boolean;
};

function normalizeProvider(provider: string | null | undefined): string | null {
  const value = typeof provider === "string" ? provider.trim() : "";
  return value ? value : null;
}

function normalizeWizardSessionMetadata(
  metadata: Partial<WizardSessionMetadata> & Pick<WizardSessionMetadata, "mode" | "intent">,
): WizardSessionMetadata {
  return {
    mode: metadata.mode,
    intent: metadata.intent,
    provider: normalizeProvider(metadata.provider),
    oauthOnly: metadata.oauthOnly === true,
  };
}

function matchesWizardSessionMetadata(
  metadata: WizardSessionMetadata,
  match?: Partial<WizardSessionMetadata>,
): boolean {
  if (!match) {
    return true;
  }
  if (match.mode && metadata.mode !== match.mode) {
    return false;
  }
  if (match.intent && metadata.intent !== match.intent) {
    return false;
  }
  if ("provider" in match && metadata.provider !== normalizeProvider(match.provider)) {
    return false;
  }
  if ("oauthOnly" in match && metadata.oauthOnly !== (match.oauthOnly === true)) {
    return false;
  }
  return true;
}

export function createWizardSessionTracker() {
  const wizardSessions = new Map<string, WizardSession>();
  const wizardSessionMetadata = new Map<string, WizardSessionMetadata>();

  const registerWizardSession = (
    id: string,
    session: WizardSession,
    metadata: Pick<WizardSessionMetadata, "mode" | "intent"> & Partial<WizardSessionMetadata>,
  ) => {
    wizardSessions.set(id, session);
    wizardSessionMetadata.set(id, normalizeWizardSessionMetadata(metadata));
  };

  const getWizardSessionMetadata = (id: string): WizardSessionMetadata | null =>
    wizardSessionMetadata.get(id) ?? null;

  const findRunningWizard = (match?: Partial<WizardSessionMetadata>): string | null => {
    for (const [id, session] of wizardSessions) {
      if (session.getStatus() !== "running") {
        continue;
      }
      const metadata = wizardSessionMetadata.get(id);
      if (!metadata) {
        continue;
      }
      if (matchesWizardSessionMetadata(metadata, match)) {
        return id;
      }
    }
    return null;
  };

  const deleteWizardSession = (id: string) => {
    wizardSessions.delete(id);
    wizardSessionMetadata.delete(id);
  };

  const purgeWizardSession = (id: string) => {
    const session = wizardSessions.get(id);
    if (!session) {
      return;
    }
    if (session.getStatus() === "running") {
      return;
    }
    deleteWizardSession(id);
  };

  return {
    wizardSessions,
    registerWizardSession,
    getWizardSessionMetadata,
    findRunningWizard,
    deleteWizardSession,
    purgeWizardSession,
  };
}
