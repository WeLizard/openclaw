import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("config localization helpers", () => {
  let storage: StorageStub;
  let i18n: typeof import("../../i18n/index.ts").i18n;
  let resolveSectionMeta: typeof import("./config.ts").resolveSectionMeta;
  let resolveSubsections: typeof import("./config.ts").resolveSubsections;

  beforeEach(async () => {
    storage = createStorage();
    storage.setItem("openclaw.i18n.locale", "ru");
    vi.stubGlobal("localStorage", storage);
    ({ i18n } = await import("../../i18n/index.ts"));
    ({ resolveSectionMeta, resolveSubsections } = await import("./config.ts"));
    await i18n.setLocale("ru");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("localizes extra section labels from section metadata", () => {
    expect(resolveSectionMeta("logging").label).toBe("Логирование");
    expect(resolveSectionMeta("diagnostics").label).toBe("Диагностика");
    expect(resolveSectionMeta("cli").description).toContain("Поведение CLI");
  });

  it("localizes auth subsections from path translations", () => {
    const entries = resolveSubsections({
      key: "auth",
      schema: {
        type: "object",
        properties: {
          cooldowns: {
            type: "object",
            title: "Auth Cooldowns",
            description:
              "Cooldown/backoff controls for temporary profile suppression after billing-related failures and retry windows.",
          },
          profiles: {
            type: "object",
            title: "Auth Profiles",
            description: "Named auth profiles (provider + mode + optional email).",
          },
        },
      },
      uiHints: {},
    });

    expect(entries.find((entry) => entry.key === "cooldowns")?.label).toBe("Cooldown-политика auth");
    expect(entries.find((entry) => entry.key === "profiles")?.label).toBe("Профили аутентификации");
    expect(entries.find((entry) => entry.key === "cooldowns")?.description).toContain(
      "Настройки cooldown/backoff",
    );
  });

  it("localizes update, cli, and diagnostics subsections from path translations", () => {
    const updateEntries = resolveSubsections({
      key: "update",
      schema: {
        type: "object",
        properties: {
          auto: {
            type: "object",
            title: "Auto",
            description: "Background auto-update policy for stable/beta rollout windows and scheduling.",
          },
          channel: {
            type: "string",
            title: "Update Channel",
            description: 'Update channel for git + npm installs ("stable", "beta", or "dev").',
          },
        },
      },
      uiHints: {},
    });
    expect(updateEntries.find((entry) => entry.key === "auto")?.label).toBe("Автообновление");
    expect(updateEntries.find((entry) => entry.key === "channel")?.label).toBe("Канал обновлений");

    const cliEntries = resolveSubsections({
      key: "cli",
      schema: {
        type: "object",
        properties: {
          banner: {
            type: "object",
            title: "CLI Banner",
            description: "CLI startup banner controls for title/version line and tagline style behavior.",
          },
        },
      },
      uiHints: {},
    });
    expect(cliEntries.find((entry) => entry.key === "banner")?.label).toBe("Баннер CLI");

    const diagnosticsEntries = resolveSubsections({
      key: "diagnostics",
      schema: {
        type: "object",
        properties: {
          cacheTrace: {
            type: "object",
            title: "Cache Trace",
            description: "Cache-trace logging settings for observing cache decisions and payload context in embedded runs.",
          },
          flags: {
            type: "array",
            title: "Diagnostics Flags",
            description: 'Enable targeted diagnostics logs by flag (e.g. ["telegram.http"]).',
          },
        },
      },
      uiHints: {},
    });
    expect(diagnosticsEntries.find((entry) => entry.key === "cacheTrace")?.label).toBe(
      "Трассировка кэша",
    );
    expect(diagnosticsEntries.find((entry) => entry.key === "flags")?.label).toBe(
      "Флаги диагностики",
    );
  });
});
