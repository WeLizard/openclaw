import { ensureAuthProfileStore, listProfilesForProvider } from "openclaw/plugin-sdk/agent-runtime";
import { QWEN_OAUTH_MARKER } from "openclaw/plugin-sdk/agent-runtime";
import { buildQwenPortalProvider, QWEN_PORTAL_BASE_URL } from "./provider-catalog.js";
import {
  buildOauthProviderAuthResult,
  definePluginEntry,
  refreshQwenPortalCredentials,
  type ProviderAuthContext,
  type ProviderCatalogContext,
  validateProviderProfileId,
} from "./runtime-api.js";

const PROVIDER_ID = "qwen-portal";
const PROVIDER_LABEL = "Qwen";
const DEFAULT_MODEL = "qwen-portal/coder-model";
const DEFAULT_BASE_URL = QWEN_PORTAL_BASE_URL;
const DEFAULT_PROFILE_ID = `${PROVIDER_ID}:default`;

function normalizeBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.endsWith("/v1") ? withProtocol : `${withProtocol.replace(/\/+$/, "")}/v1`;
}

function buildProviderCatalog(params: { baseUrl: string; apiKey: string }) {
  return {
    ...buildQwenPortalProvider(),
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
  };
}

function buildProfileId(suffix: string): string {
  return `${PROVIDER_ID}:${suffix}`;
}

function sanitizeProfileSuffix(raw: string): string | null {
  const normalized = raw
    .trim()
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, " ")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || null;
}

function resolveRequestedProfileId(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.includes(":")) {
    return validateProviderProfileId(trimmed, PROVIDER_ID);
  }
  const suffix = sanitizeProfileSuffix(trimmed);
  return suffix ? buildProfileId(suffix) : null;
}

function resolveIdentityProfileId(result: {
  email?: string | null;
  accountId?: string | null;
  username?: string | null;
}): string | null {
  const candidate = [result.email, result.accountId, result.username]
    .map((value) => (typeof value === "string" ? sanitizeProfileSuffix(value) : null))
    .find((value): value is string => Boolean(value));
  return candidate ? buildProfileId(candidate) : null;
}

async function resolveQwenProfileId(params: {
  ctx: ProviderAuthContext;
  result: {
    email?: string | null;
    accountId?: string | null;
    username?: string | null;
  };
}): Promise<string> {
  const explicit = resolveRequestedProfileId(params.ctx.opts?.profileId);
  if (explicit) {
    return explicit;
  }

  const detected = resolveIdentityProfileId(params.result);
  if (detected) {
    return detected;
  }

  const authStore = ensureAuthProfileStore(params.ctx.agentDir, {
    allowKeychainPrompt: false,
  });
  const existingProfiles = listProfilesForProvider(authStore, PROVIDER_ID);
  if (existingProfiles.length === 0) {
    return DEFAULT_PROFILE_ID;
  }

  await params.ctx.prompter.note(
    [
      "Qwen did not expose a stable account identity for this login.",
      "Enter a short label to store this account as a separate profile.",
      "Use distinct Qwen accounts here: re-authorizing the same upstream account can invalidate older refresh tokens.",
    ].join("\n"),
    "Qwen account label",
  );

  const label = await params.ctx.prompter.text({
    message: "Qwen profile label",
    initialValue: "work",
    placeholder: "work",
    validate: (value) => {
      const suffix = sanitizeProfileSuffix(value);
      return suffix ? undefined : "Enter a short label such as work or backup";
    },
  });
  const suffix = sanitizeProfileSuffix(label);
  if (!suffix) {
    throw new Error("Qwen profile label is required.");
  }
  return buildProfileId(suffix);
}

function resolveCatalog(ctx: ProviderCatalogContext) {
  const explicitProvider = ctx.config.models?.providers?.[PROVIDER_ID];
  const envApiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
  const authStore = ensureAuthProfileStore(ctx.agentDir, {
    allowKeychainPrompt: false,
  });
  const hasProfiles = listProfilesForProvider(authStore, PROVIDER_ID).length > 0;
  const explicitApiKey =
    typeof explicitProvider?.apiKey === "string" ? explicitProvider.apiKey.trim() : undefined;
  const apiKey = envApiKey ?? explicitApiKey ?? (hasProfiles ? QWEN_OAUTH_MARKER : undefined);
  if (!apiKey) {
    return null;
  }

  const explicitBaseUrl =
    typeof explicitProvider?.baseUrl === "string" ? explicitProvider.baseUrl : undefined;

  return {
    provider: buildProviderCatalog({
      baseUrl: normalizeBaseUrl(explicitBaseUrl),
      apiKey,
    }),
  };
}

export default definePluginEntry({
  id: "qwen-portal-auth",
  name: "Qwen OAuth",
  description: "OAuth flow for Qwen (free-tier) models",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/qwen",
      aliases: ["qwen"],
      envVars: ["QWEN_OAUTH_TOKEN", "QWEN_PORTAL_API_KEY"],
      catalog: {
        run: async (ctx: ProviderCatalogContext) => resolveCatalog(ctx),
      },
      auth: [
        {
          id: "device",
          label: "Qwen OAuth",
          hint: "Device code login",
          kind: "device_code",
          run: async (ctx: ProviderAuthContext) => {
            const progress = ctx.prompter.progress("Starting Qwen OAuth…");
            try {
              const { loginQwenPortalOAuth } = await import("./oauth.runtime.js");
              const result = await loginQwenPortalOAuth({
                openUrl: ctx.openUrl,
                note: ctx.prompter.note,
                progress,
              });

              progress.stop("Qwen OAuth complete");

              const baseUrl = normalizeBaseUrl(result.resourceUrl);
              const profileId = await resolveQwenProfileId({ ctx, result });

              return buildOauthProviderAuthResult({
                providerId: PROVIDER_ID,
                defaultModel: DEFAULT_MODEL,
                access: result.access,
                refresh: result.refresh,
                expires: result.expires,
                email: result.email,
                profileId,
                configPatch: {
                  models: {
                    providers: {
                      [PROVIDER_ID]: {
                        baseUrl,
                        models: [],
                      },
                    },
                  },
                  agents: {
                    defaults: {
                      models: {
                        "qwen-portal/coder-model": { alias: "qwen" },
                        "qwen-portal/vision-model": {},
                      },
                    },
                  },
                },
                notes: [
                  "Qwen OAuth tokens auto-refresh. Re-run login if refresh fails or access is revoked.",
                  "Use separate auth profiles for distinct Qwen accounts. Re-authorizing the same upstream account can invalidate older refresh tokens.",
                  `Base URL defaults to ${DEFAULT_BASE_URL}. Override models.providers.${PROVIDER_ID}.baseUrl if needed.`,
                ],
              });
            } catch (err) {
              progress.stop("Qwen OAuth failed");
              await ctx.prompter.note(
                "If OAuth fails, verify your Qwen account has portal access and try again.",
                "Qwen OAuth",
              );
              throw err;
            }
          },
        },
      ],
      wizard: {
        setup: {
          choiceId: "qwen-portal",
          choiceLabel: "Qwen OAuth",
          choiceHint: "Device code login",
          methodId: "device",
        },
      },
      refreshOAuth: async (cred) => ({
        ...cred,
        ...(await refreshQwenPortalCredentials(cred)),
        type: "oauth",
        provider: PROVIDER_ID,
        email: cred.email,
      }),
    });
  },
});
