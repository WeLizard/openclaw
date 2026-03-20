import type {
  WizardConfirmParams,
  WizardMultiSelectParams,
  WizardPrompter,
  WizardSelectOption,
  WizardSelectParams,
  WizardTextParams,
} from "./prompts.js";

type SupportedWizardLocale = "en" | "ru";

const LINE_TRANSLATIONS_RU = new Map<string, string>([
  ["Security warning — please read.", "Предупреждение по безопасности — обязательно прочитайте."],
  [
    "OpenClaw is a hobby project and still in beta. Expect sharp edges.",
    "OpenClaw — это хобби-проект и он всё ещё в бете. Ожидай шероховатости и острые углы.",
  ],
  [
    "By default, OpenClaw is a personal agent: one trusted operator boundary.",
    "По умолчанию OpenClaw — это персональный агент: один доверенный оператор, одна граница доверия.",
  ],
  [
    "This bot can read files and run actions if tools are enabled.",
    "Этот бот может читать файлы и выполнять действия, если инструменты включены.",
  ],
  [
    "A bad prompt can trick it into doing unsafe things.",
    "Небезопасный промпт может заставить его сделать опасные вещи.",
  ],
  [
    "OpenClaw is not a hostile multi-tenant boundary by default.",
    "По умолчанию OpenClaw не является защищённой границей для враждебной multi-tenant среды.",
  ],
  [
    "If multiple users can message one tool-enabled agent, they share that delegated tool authority.",
    "Если несколько пользователей могут писать одному агенту с включёнными инструментами, они разделяют эти делегированные права.",
  ],
  [
    "If you’re not comfortable with security hardening and access control, don’t run OpenClaw.",
    "Если ты не уверен в hardening'е безопасности и контроле доступа, не запускай OpenClaw.",
  ],
  [
    "Ask someone experienced to help before enabling tools or exposing it to the internet.",
    "Привлеки опытного человека до того, как включать инструменты или публиковать это в интернет.",
  ],
  ["Recommended baseline:", "Рекомендуемый базовый минимум:"],
  ["- Pairing/allowlists + mention gating.", "- Pairing/allowlists + ограничение по упоминанию."],
  [
    "- Multi-user/shared inbox: split trust boundaries (separate gateway/credentials, ideally separate OS users/hosts).",
    "- Для multi-user/shared inbox: разделяй границы доверия (отдельный gateway/credentials, в идеале отдельные OS users/hosts).",
  ],
  ["- Sandbox + least-privilege tools.", "- Sandbox + инструменты с минимально необходимыми правами."],
  [
    "- Shared inboxes: isolate DM sessions (`session.dmScope: per-channel-peer`) and keep tool access minimal.",
    "- Для shared inbox: изолируй DM-сессии (`session.dmScope: per-channel-peer`) и держи доступ к инструментам минимальным.",
  ],
  [
    "- Keep secrets out of the agent’s reachable filesystem.",
    "- Не держи секреты в файловой системе, до которой агент может дотянуться.",
  ],
  [
    "- Use the strongest available model for any bot with tools or untrusted inboxes.",
    "- Для ботов с инструментами или недоверенными inbox используй максимально сильную доступную модель.",
  ],
  ["Run regularly:", "Регулярно запускай:"],
  ["Must read: https://docs.openclaw.ai/gateway/security", "Обязательно к прочтению: https://docs.openclaw.ai/gateway/security"],
  [
    "I understand this is personal-by-default and shared/multi-user use requires lock-down. Continue?",
    "Я понимаю, что по умолчанию это персональная установка, а shared/multi-user сценарий требует жёсткого lock-down. Продолжить?",
  ],
  ["Onboarding mode", "Режим настройки"],
  ["QuickStart", "Быстрый старт"],
  ["Manual", "Ручной режим"],
  [
    "Configure details later via openclaw configure.",
    "Остальные детали можно настроить позже через openclaw configure.",
  ],
  [
    "Configure port, network, Tailscale, and auth options.",
    "Настроить порт, сеть, Tailscale и параметры аутентификации.",
  ],
  [
    "QuickStart only supports local gateways. Switching to Manual mode.",
    "QuickStart поддерживает только локальные gateway. Переключаюсь на ручной режим.",
  ],
  ["Existing config detected", "Обнаружен существующий конфиг"],
  ["Config handling", "Что делать с текущим конфигом"],
  ["Use existing values", "Использовать текущие значения"],
  ["Update values", "Обновить значения"],
  ["Reset", "Сбросить"],
  ["Reset scope", "Глубина сброса"],
  ["Config only", "Только конфиг"],
  ["Config + creds + sessions", "Конфиг + учётные данные + сессии"],
  [
    "Full reset (config + creds + sessions + workspace)",
    "Полный сброс (конфиг + учётные данные + сессии + workspace)",
  ],
  ["Keeping your current gateway settings:", "Сохраняю текущие настройки gateway:"],
  ["Direct to chat channels.", "Сразу в чат-каналы."],
  ["Gateway auth", "Аутентификация gateway"],
  ["What do you want to set up?", "Что нужно настроить?"],
  ["Local gateway (this machine)", "Локальный gateway (эта машина)"],
  ["Remote gateway (info-only)", "Удалённый gateway (только подключение)"],
  ["No remote URL configured yet", "Удалённый URL пока не настроен"],
  ["Workspace directory", "Директория workspace"],
  ["Model/auth provider", "Провайдер модели / авторизации"],
  ["No auth methods available for that provider.", "Для этого провайдера нет доступных способов авторизации."],
  ["Model/auth choice", "Выбор провайдера / авторизации"],
  ["Back", "Назад"],
  ["Filter models by provider", "Фильтр моделей по провайдеру"],
  ["All providers", "Все провайдеры"],
  ["Default model", "Модель по умолчанию"],
  ["Default model (blank to keep)", "Модель по умолчанию (оставь пустым, чтобы не менять)"],
  ["Enter model manually", "Ввести модель вручную"],
  ["current (not in catalog)", "текущая (не из каталога)"],
  ["Model check", "Проверка модели"],
  ["Channel status", "Статус каналов"],
  ["How channels work", "Как работают каналы"],
  ["Configure chat channels now?", "Настроить чат-каналы сейчас?"],
  [
    "Configure DM access policies now? (default: pairing)",
    "Настроить политики доступа в DM сейчас? (по умолчанию pairing)",
  ],
  ["Select channel (QuickStart)", "Выбери канал (Быстрый старт)"],
  ["Skipping channel setup.", "Пропускаю настройку каналов."],
  ["Channels", "Каналы"],
  ["Skipping skills setup.", "Пропускаю настройку навыков."],
  ["Skills", "Навыки"],
  ["OpenAI Codex OAuth", "OpenAI Codex OAuth"],
  ["OAuth prerequisites", "Требования для OAuth"],
  ["OAuth help", "Помощь по OAuth"],
  ["Browser will open for OpenAI authentication.", "Сейчас откроется браузер для авторизации OpenAI."],
  [
    "If the callback doesn't auto-complete, paste the redirect URL.",
    "Если callback не завершится автоматически, вставь redirect URL вручную.",
  ],
  ["OpenAI OAuth uses localhost:1455 for the callback.", "OpenAI OAuth использует localhost:1455 для callback."],
  ["You are running in a remote/VPS environment.", "Ты работаешь в удалённой / VPS-среде."],
  [
    "A URL will be shown for you to open in your LOCAL browser.",
    "Сейчас будет показан URL, который нужно открыть в ЛОКАЛЬНОМ браузере.",
  ],
  ["After signing in, paste the redirect URL back here.", "После входа вставь сюда redirect URL."],
  ["Paste the redirect URL", "Вставь redirect URL"],
  ["Starting OAuth flow…", "Запуск OAuth-потока…"],
  ["OAuth URL ready", "OAuth URL готов"],
  ["OpenAI OAuth complete", "OpenAI OAuth завершён"],
  ["OpenAI OAuth failed", "OpenAI OAuth завершился ошибкой"],
  ["Trouble with OAuth? See https://docs.openclaw.ai/start/faq", "Проблемы с OAuth? См. https://docs.openclaw.ai/start/faq"],
  ["Provider notes", "Заметки по провайдеру"],
  ["Model configured", "Модель настроена"],
  ["Auth setup complete.", "Настройка авторизации завершена."],
  ["Provider auth", "Авторизация провайдера"],
  ["How do you want to hatch your bot?", "Как хочешь запустить своего бота?"],
  ["Hatch in TUI (recommended)", "Запустить в TUI (рекомендуется)"],
  ["Open the Web UI", "Открыть Web UI"],
  ["Do this later", "Сделать это позже"],
  ["Start TUI (best option!)", "Запуск TUI (лучший вариант!)"],
  ["Web UI", "Web UI"],
  [
    "TUI hatch is unavailable from this session. Open the Web UI instead.",
    "Запуск через TUI недоступен из этой сессии. Вместо этого открой Web UI.",
  ],
  [
    "Config is invalid. Fix it first, then re-run auth setup.",
    "Конфиг сейчас невалиден. Сначала исправь его, потом повтори настройку авторизации.",
  ],
]);

function resolveWizardLocale(rawLocale?: string): SupportedWizardLocale {
  const normalized = String(rawLocale ?? "").trim().toLowerCase();
  return normalized.startsWith("ru") ? "ru" : "en";
}

function translateRuLine(line: string): string {
  if (!line) {
    return line;
  }

  const exact = LINE_TRANSLATIONS_RU.get(line);
  if (exact) {
    return exact;
  }

  let match = line.match(/^Gateway port: (.+)$/);
  if (match) {
    return `Порт gateway: ${match[1]}`;
  }
  match = line.match(/^Gateway bind: (.+)$/);
  if (match) {
    return `Привязка gateway: ${match[1]}`;
  }
  match = line.match(/^Gateway custom IP: (.+)$/);
  if (match) {
    return `Пользовательский IP gateway: ${match[1]}`;
  }
  match = line.match(/^Gateway auth: (.+)$/);
  if (match) {
    return `Аутентификация gateway: ${match[1]}`;
  }
  match = line.match(/^Tailscale exposure: (.+)$/);
  if (match) {
    return `Публикация через Tailscale: ${match[1]}`;
  }
  match = line.match(/^Gateway reachable \((.+)\)$/);
  if (match) {
    return `Gateway доступен (${match[1]})`;
  }
  match = line.match(/^No gateway detected \((.+)\)$/);
  if (match) {
    return `Gateway не найден (${match[1]})`;
  }
  match = line.match(/^Configured but unreachable \((.+)\)$/);
  if (match) {
    return `Настроен, но недоступен (${match[1]})`;
  }
  match = line.match(/^Keep current \((.+)\)$/);
  if (match) {
    return `Оставить текущее значение (${match[1]})`;
  }
  match = line.match(/^Keep current \(default: (.+)\)$/);
  if (match) {
    return `Оставить текущее значение (по умолчанию: ${match[1]})`;
  }
  match = line.match(/^Default model set to (.+)$/);
  if (match) {
    return `Модель по умолчанию установлена: ${match[1]}`;
  }
  match = line.match(
    /^Model not found: (.+)\. Update agents\.defaults\.model or run \/models list\.$/,
  );
  if (match) {
    return `Модель не найдена: ${match[1]}. Обнови agents.defaults.model или запусти /models list.`;
  }
  match = line.match(
    /^No auth configured for provider "(.+)"\. The agent may fail until credentials are added\.$/,
  );
  if (match) {
    return `Для провайдера "${match[1]}" не настроена авторизация. Агент может сбоить, пока не будут добавлены credentials.`;
  }
  match = line.match(
    /^Detected OpenAI Codex OAuth\. Consider setting agents\.defaults\.model to (.+)\.$/,
  );
  if (match) {
    return `Обнаружен OpenAI Codex OAuth. Имеет смысл установить agents.defaults.model = ${match[1]}.`;
  }
  match = line.match(/^(.+?) auth method$/);
  if (match) {
    return `Способ авторизации: ${match[1]}`;
  }
  match = line.match(/^(.+): (\d+) models$/);
  if (match) {
    return `${match[1]}: ${match[2]} моделей`;
  }
  match = line.match(/^(.+): 1 model$/);
  if (match) {
    return `${match[1]}: 1 модель`;
  }

  return line;
}

function translateWizardText(value: string, locale: SupportedWizardLocale): string {
  if (locale !== "ru" || !value) {
    return value;
  }
  return value
    .split("\n")
    .map((line) => translateRuLine(line))
    .join("\n");
}

function mapOption<T>(
  option: WizardSelectOption<T>,
  locale: SupportedWizardLocale,
): WizardSelectOption<T> {
  return {
    ...option,
    label: translateWizardText(option.label, locale),
    ...(option.hint ? { hint: translateWizardText(option.hint, locale) } : {}),
  };
}

function mapSelectParams<T>(
  params: WizardSelectParams<T>,
  locale: SupportedWizardLocale,
): WizardSelectParams<T> {
  return {
    ...params,
    message: translateWizardText(params.message, locale),
    options: params.options.map((option) => mapOption(option, locale)),
  };
}

function mapMultiSelectParams<T>(
  params: WizardMultiSelectParams<T>,
  locale: SupportedWizardLocale,
): WizardMultiSelectParams<T> {
  return {
    ...params,
    message: translateWizardText(params.message, locale),
    options: params.options.map((option) => mapOption(option, locale)),
  };
}

function mapTextParams(params: WizardTextParams, locale: SupportedWizardLocale): WizardTextParams {
  return {
    ...params,
    message: translateWizardText(params.message, locale),
    ...(params.placeholder
      ? { placeholder: translateWizardText(params.placeholder, locale) }
      : {}),
  };
}

function mapConfirmParams(
  params: WizardConfirmParams,
  locale: SupportedWizardLocale,
): WizardConfirmParams {
  return {
    ...params,
    message: translateWizardText(params.message, locale),
  };
}

export function localizeWizardPrompter(
  prompter: WizardPrompter,
  rawLocale?: string,
): WizardPrompter {
  const locale = resolveWizardLocale(rawLocale);
  if (locale === "en") {
    return prompter;
  }

  return {
    intro: async (title) => await prompter.intro(translateWizardText(title, locale)),
    outro: async (message) => await prompter.outro(translateWizardText(message, locale)),
    note: async (message, title) =>
      await prompter.note(
        translateWizardText(message, locale),
        title ? translateWizardText(title, locale) : title,
      ),
    select: async <T>(params: WizardSelectParams<T>) =>
      await prompter.select(mapSelectParams(params, locale)),
    multiselect: async <T>(params: WizardMultiSelectParams<T>) =>
      await prompter.multiselect(mapMultiSelectParams(params, locale)),
    text: async (params: WizardTextParams) => await prompter.text(mapTextParams(params, locale)),
    confirm: async (params: WizardConfirmParams) =>
      await prompter.confirm(mapConfirmParams(params, locale)),
    progress: (label) => {
      const progress = prompter.progress(translateWizardText(label, locale));
      return {
        update: (message: string) => progress.update(translateWizardText(message, locale)),
        stop: (message?: string) =>
          progress.stop(message ? translateWizardText(message, locale) : message),
      };
    },
  };
}
