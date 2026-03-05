import { describe, expect, it, beforeEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  clearSemanticCacheForTests,
  lookupSemanticCache,
  resolveSemanticCacheSettings,
  storeSemanticCacheEntry,
} from "./semantic-cache.js";

describe("semantic-cache", () => {
  beforeEach(() => {
    clearSemanticCacheForTests();
  });

  it("is disabled by default", () => {
    expect(resolveSemanticCacheSettings(undefined)).toBeNull();
    expect(
      resolveSemanticCacheSettings({
        agents: { defaults: { semanticCache: { mode: "off" } } },
      } as OpenClawConfig),
    ).toBeNull();
  });

  it("stores and resolves exact matches", () => {
    const settings = resolveSemanticCacheSettings({
      agents: {
        defaults: {
          semanticCache: {
            mode: "exact",
            minPromptChars: 1,
          },
        },
      },
    } as OpenClawConfig);
    if (!settings) {
      throw new Error("expected settings");
    }
    storeSemanticCacheEntry({
      settings,
      sessionKey: "agent:main:main",
      prompt: "Какая погода дома?",
      responseText: "В гостиной 23°C.",
      now: 1_000,
    });
    const hit = lookupSemanticCache({
      settings,
      sessionKey: "agent:main:main",
      prompt: "какая   погода дома",
      now: 2_000,
    });
    expect(hit?.responseText).toBe("В гостиной 23°C.");
    expect(hit?.similarity).toBe(1);
  });

  it("resolves semantic matches by token overlap", () => {
    const settings = resolveSemanticCacheSettings({
      agents: {
        defaults: {
          semanticCache: {
            mode: "semantic",
            minPromptChars: 1,
            minSimilarity: 0.3,
          },
        },
      },
    } as OpenClawConfig);
    if (!settings) {
      throw new Error("expected settings");
    }
    storeSemanticCacheEntry({
      settings,
      sessionKey: "agent:main:main",
      prompt: "сколько градусов в спальне сейчас",
      responseText: "Сейчас в спальне 21°C.",
      now: 10_000,
    });
    const hit = lookupSemanticCache({
      settings,
      sessionKey: "agent:main:main",
      prompt: "какая сейчас температура в спальне",
      now: 11_000,
    });
    expect(hit).not.toBeNull();
    expect(hit?.responseText).toContain("21");
    expect((hit?.similarity ?? 0) >= 0.3).toBe(true);
  });

  it("does not cache action prompts when cacheActions=false", () => {
    const settings = resolveSemanticCacheSettings({
      agents: {
        defaults: {
          semanticCache: {
            mode: "semantic",
            minPromptChars: 1,
            cacheActions: false,
          },
        },
      },
    } as OpenClawConfig);
    if (!settings) {
      throw new Error("expected settings");
    }
    storeSemanticCacheEntry({
      settings,
      sessionKey: "agent:main:main",
      prompt: "Включи свет в гостиной",
      responseText: "Свет включен.",
      now: 20_000,
    });
    const hit = lookupSemanticCache({
      settings,
      sessionKey: "agent:main:main",
      prompt: "Включи свет в гостиной",
      now: 21_000,
    });
    expect(hit).toBeNull();
  });

  it("does not share cache hits across different models in the same session", () => {
    const settings = resolveSemanticCacheSettings({
      agents: {
        defaults: {
          semanticCache: {
            mode: "exact",
            minPromptChars: 1,
          },
        },
      },
    } as OpenClawConfig);
    if (!settings) {
      throw new Error("expected settings");
    }
    storeSemanticCacheEntry({
      settings,
      sessionKey: "agent:main:main",
      provider: "qwen-portal",
      model: "qwen-plus",
      prompt: "Какая температура в спальне?",
      responseText: "В спальне 21°C.",
      now: 30_000,
    });

    const wrongModelHit = lookupSemanticCache({
      settings,
      sessionKey: "agent:main:main",
      provider: "openai",
      model: "gpt-5.4",
      prompt: "Какая температура в спальне?",
      now: 31_000,
    });
    expect(wrongModelHit).toBeNull();

    const sameModelHit = lookupSemanticCache({
      settings,
      sessionKey: "agent:main:main",
      provider: "qwen-portal",
      model: "qwen-plus",
      prompt: "Какая температура в спальне?",
      now: 31_000,
    });
    expect(sameModelHit?.responseText).toBe("В спальне 21°C.");
  });
});
