import { randomUUID } from "node:crypto";
import type { OnboardMode } from "../../commands/onboard-types.js";
import { defaultRuntime } from "../../runtime.js";
import { localizeWizardPrompter } from "../../wizard/localized-prompter.js";
import { WizardSession } from "../../wizard/session.js";
import {
  ErrorCodes,
  errorShape,
  validateWizardCancelParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function readWizardStatus(session: WizardSession) {
  return {
    status: session.getStatus(),
    error: session.getError(),
  };
}

function findWizardSessionOrRespond(params: {
  context: GatewayRequestContext;
  respond: RespondFn;
  sessionId: string;
}): WizardSession | null {
  const session = params.context.wizardSessions.get(params.sessionId);
  if (!session) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
    return null;
  }
  return session;
}

export const wizardHandlers: GatewayRequestHandlers = {
  "wizard.start": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStartParams, "wizard.start", respond)) {
      return;
    }
    const explicitIntent: "onboarding" | "models-auth-login" =
      params.intent === "models-auth-login" || params.flow === "models-auth-login"
        ? "models-auth-login"
        : "onboarding";
    const mode: OnboardMode = params.mode === "remote" ? "remote" : "local";
    const sessionMetadata = {
      mode,
      intent: explicitIntent,
      provider: typeof params.provider === "string" ? params.provider : null,
      oauthOnly: params.oauthOnly === true,
    } as const;
    const running = context.findRunningWizard(sessionMetadata);
    if (running) {
      const runningSession = context.wizardSessions.get(running);
      if (runningSession) {
        const result = await runningSession.next();
        if (result.done) {
          context.purgeWizardSession(running);
        }
        respond(true, { sessionId: running, ...result }, undefined);
        return;
      }
    }
    const sessionId = randomUUID();
    const flow =
      params.flow === "quickstart" || params.flow === "advanced" || params.flow === "manual"
        ? params.flow
        : undefined;
    const opts = {
      mode,
      flow,
      intent: explicitIntent,
      provider: typeof params.provider === "string" ? params.provider : undefined,
      oauthOnly: params.oauthOnly === true,
      locale: typeof params.locale === "string" ? params.locale : undefined,
      workspace: typeof params.workspace === "string" ? params.workspace : undefined,
    };
    const session = new WizardSession((prompter) =>
      context.wizardRunner(
        opts,
        defaultRuntime,
        localizeWizardPrompter(prompter, opts.locale),
      ),
    );
    context.registerWizardSession(sessionId, session, sessionMetadata);
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },
  "wizard.next": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardNextParams, "wizard.next", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    const answer = params.answer as { stepId?: string; value?: unknown } | undefined;
    if (answer) {
      if (session.getStatus() !== "running") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"));
        return;
      }
      try {
        await session.answer(String(answer.stepId ?? ""), answer.value);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
        return;
      }
    }
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, result, undefined);
  },
  "wizard.cancel": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardCancelParams, "wizard.cancel", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    session.cancel();
    const status = readWizardStatus(session);
    context.deleteWizardSession(sessionId);
    respond(true, status, undefined);
  },
  "wizard.status": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStatusParams, "wizard.status", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    const status = readWizardStatus(session);
    if (status.status !== "running") {
      context.deleteWizardSession(sessionId);
    }
    respond(true, status, undefined);
  },
};
