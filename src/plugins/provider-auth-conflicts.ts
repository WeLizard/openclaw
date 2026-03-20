import { normalizeProviderIdForAuth } from "../agents/provider-id.js";
import { loadAuthProfileStoreForRuntime } from "../agents/auth-profiles.js";
import type { AuthProfileCredential } from "../agents/auth-profiles/types.js";
import type { WizardPrompter } from "../wizard/prompts.js";

type AuthProfileDraft = {
  profileId: string;
  credential: AuthProfileCredential;
};

function profileUsesOAuth(profile: AuthProfileCredential | undefined): boolean {
  return profile?.type === "oauth";
}

export function validateProviderProfileId(profileId: string, providerId: string): string {
  const trimmed = profileId.trim();
  if (!trimmed) {
    throw new Error("Profile id cannot be empty.");
  }
  const separator = trimmed.indexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new Error(
      `Invalid profile id "${trimmed}". Use the format "${providerId}:<suffix>".`,
    );
  }
  const prefix = trimmed.slice(0, separator);
  if (normalizeProviderIdForAuth(prefix) !== normalizeProviderIdForAuth(providerId)) {
    throw new Error(
      `Profile id "${trimmed}" does not belong to provider "${providerId}". Use the format "${providerId}:<suffix>".`,
    );
  }
  return trimmed;
}

export async function confirmAuthProfileOverwrites(params: {
  profiles: AuthProfileDraft[];
  agentDir?: string;
  prompter: Pick<WizardPrompter, "confirm" | "note">;
}): Promise<boolean> {
  let store;
  try {
    store = loadAuthProfileStoreForRuntime(params.agentDir, {
      allowKeychainPrompt: false,
    });
  } catch {
    // Best-effort guard only. Re-auth should still run when the existing store
    // is unreadable because the user may be trying to repair it.
    return true;
  }

  for (const draft of params.profiles) {
    const existing = store.profiles[draft.profileId];
    if (!existing) {
      continue;
    }

    const noteLines = [`Auth profile already exists: ${draft.profileId}.`];
    if (profileUsesOAuth(existing) || profileUsesOAuth(draft.credential)) {
      noteLines.push(
        "Re-authenticating the same upstream OAuth account can invalidate the previous refresh token.",
        "Use separate profiles for distinct accounts. Replace this profile only when you intend to refresh it.",
      );
    }
    await params.prompter.note(noteLines.join("\n"), "Existing profile");

    const replace = await params.prompter.confirm({
      message: `Replace existing profile ${draft.profileId}?`,
      initialValue: false,
    });
    if (!replace) {
      await params.prompter.note(
        `Kept existing auth profile ${draft.profileId}.`,
        "Auth unchanged",
      );
      return false;
    }
  }

  return true;
}
