import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveRequestOptimization } from "./request-optimization.js";

function withConfig(partial: Partial<OpenClawConfig>): OpenClawConfig {
  return partial as OpenClawConfig;
}

describe("request-optimization", () => {
  it("is no-op when tokenOptimization is not configured", () => {
    const prompt = "  keep exact prompt formatting  ";
    const result = resolveRequestOptimization({
      prompt,
      provider: "qwen",
      model: "qwen-plus",
      config: withConfig({}),
    });

    expect(result.prompt).toBe(prompt);
    expect(result.route.tier).toBe(4);
    expect(result.notes).toEqual([]);
  });

  it("packs dense state lines into compact snapshot block", () => {
    const cfg = withConfig({
      agents: {
        defaults: {
          tokenOptimization: {
            inputStructuring: {
              enabled: true,
              parseStateLines: true,
              minStateLines: 3,
            },
            planner: { mode: "off" },
          },
        },
      },
    });

    const prompt = [
      "Состояние дома:",
      "light.kitchen: on",
      "sensor.living_temp=22.4",
      "switch.boiler : off",
      "sensor.humidity=45%",
    ].join("\n");

    const result = resolveRequestOptimization({
      prompt,
      provider: "qwen",
      model: "qwen-plus",
      config: cfg,
    });

    expect(result.prompt).toContain("[ha_state_snapshot]");
    expect(result.notes.some((note) => note.startsWith("input-structuring:packed-state-lines"))).toBe(
      true,
    );
  });

  it("injects planner hints for multi-action requests", () => {
    const cfg = withConfig({
      agents: {
        defaults: {
          tokenOptimization: {
            planner: {
              mode: "auto",
              batching: true,
              decomposition: true,
              decomposeScoreThreshold: 4,
              maxSubtasks: 6,
            },
          },
        },
      },
    });

    const result = resolveRequestOptimization({
      prompt: "Включи свет в гостиной и поставь будильник на 7:00, а потом включи музыку.",
      provider: "qwen",
      model: "qwen-plus",
      config: cfg,
    });

    expect(result.prompt).toContain("[openclaw_planner]");
    expect(result.notes).toContain("planner:hints-injected");
  });

  it("routes simple prompts to tier-3 cheap model when configured", () => {
    const cfg = withConfig({
      agents: {
        defaults: {
          tokenOptimization: {
            cascade: {
              mode: "auto",
              cheapModel: "qwen/qwen3-8b",
              simplePromptChars: 260,
              simpleScoreThreshold: 3,
            },
            planner: { mode: "off" },
          },
        },
      },
    });

    const result = resolveRequestOptimization({
      prompt: "Какая температура в спальне?",
      provider: "qwen",
      model: "qwen-plus",
      config: cfg,
    });

    expect(result.route.tier).toBe(3);
    expect(result.route.provider).toBe("qwen-portal");
    expect(result.route.model).toBe("qwen3-8b");
  });

  it("keeps tier-4 route for complex requests", () => {
    const cfg = withConfig({
      agents: {
        defaults: {
          tokenOptimization: {
            cascade: {
              mode: "auto",
              cheapModel: "qwen/qwen3-8b",
              simplePromptChars: 260,
              complexPromptChars: 500,
              simpleScoreThreshold: 2,
            },
            planner: {
              mode: "auto",
              decomposition: true,
              decomposeScoreThreshold: 3.5,
            },
          },
        },
      },
    });

    const result = resolveRequestOptimization({
      prompt:
        "Сделай стратегию повышения энергоэффективности квартиры на месяц: учти погоду, тарифы, привычки семьи, " +
        "распиши по неделям и предложи автоматизации Home Assistant с приоритетами.",
      provider: "qwen",
      model: "qwen-plus",
      config: cfg,
    });

    expect(result.route.tier).toBe(4);
    expect(result.prompt).toContain("[openclaw_planner]");
  });
});
