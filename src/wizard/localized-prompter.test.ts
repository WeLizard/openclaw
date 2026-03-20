import { describe, expect, it, vi } from "vitest";
import { localizeWizardPrompter } from "./localized-prompter.js";
import type { WizardPrompter } from "./prompts.js";

function createPrompter() {
  return {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async () => {}),
    select: vi.fn(async () => "value"),
    multiselect: vi.fn(async () => []),
    text: vi.fn(async () => "value"),
    confirm: vi.fn(async () => true),
    progress: vi.fn(() => ({
      update: vi.fn(),
      stop: vi.fn(),
    })),
  } satisfies WizardPrompter;
}

describe("localizeWizardPrompter", () => {
  it("translates qwen account labeling notes into russian", async () => {
    const prompter = createPrompter();
    const localized = localizeWizardPrompter(prompter, "ru");

    await localized.note(
      [
        "Qwen did not expose a stable account identity for this login.",
        "Enter a short label to store this account as a separate profile.",
        "Use distinct Qwen accounts here: re-authorizing the same upstream account can invalidate older refresh tokens.",
      ].join("\n"),
      "Qwen account label",
    );

    expect(prompter.note).toHaveBeenCalledWith(
      [
        "Qwen не отдал стабильный идентификатор аккаунта для этого входа.",
        "Введи короткую метку, чтобы сохранить этот аккаунт как отдельный профиль.",
        "Здесь используй разные аккаунты Qwen: повторная авторизация того же upstream-аккаунта может инвалидировать старые refresh token.",
      ].join("\n"),
      "Метка аккаунта Qwen",
    );
  });

  it("translates existing profile overwrite prompts into russian", async () => {
    const prompter = createPrompter();
    const localized = localizeWizardPrompter(prompter, "ru");

    await localized.note(
      [
        "Auth profile already exists: qwen-portal:work.",
        "Re-authenticating the same upstream OAuth account can invalidate the previous refresh token.",
        "Use separate profiles for distinct accounts. Replace this profile only when you intend to refresh it.",
      ].join("\n"),
      "Existing profile",
    );
    await localized.confirm({
      message: "Replace existing profile qwen-portal:work?",
      initialValue: false,
    });

    expect(prompter.note).toHaveBeenCalledWith(
      [
        "Профиль авторизации уже существует: qwen-portal:work.",
        "Повторная авторизация того же upstream OAuth-аккаунта может инвалидировать предыдущий refresh token.",
        "Используй отдельные профили для разных аккаунтов. Заменяй этот профиль только если действительно хочешь его переавторизовать.",
      ].join("\n"),
      "Существующий профиль",
    );
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Заменить существующий профиль qwen-portal:work?",
      initialValue: false,
    });
  });
});
