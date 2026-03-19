import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const WizardRunStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("cancelled"),
  Type.Literal("error"),
]);

export const WizardStartParamsSchema = Type.Object(
  {
    mode: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("remote")])),
    flow: Type.Optional(
      Type.Union([
        Type.Literal("quickstart"),
        Type.Literal("advanced"),
        Type.Literal("manual"),
        Type.Literal("onboarding"),
        Type.Literal("models-auth-login"),
      ]),
    ),
    intent: Type.Optional(
      Type.Union([Type.Literal("onboarding"), Type.Literal("models-auth-login")]),
    ),
    provider: Type.Optional(Type.String()),
    oauthOnly: Type.Optional(Type.Boolean()),
    locale: Type.Optional(Type.String()),
    workspace: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WizardAnswerSchema = Type.Object(
  {
    stepId: NonEmptyString,
    value: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const WizardNextParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    answer: Type.Optional(WizardAnswerSchema),
  },
  { additionalProperties: false },
);

const WizardSessionIdParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WizardCancelParamsSchema = WizardSessionIdParamsSchema;

export const WizardStatusParamsSchema = WizardSessionIdParamsSchema;

export const WizardStepOptionSchema = Type.Object(
  {
    value: Type.Unknown(),
    label: NonEmptyString,
    hint: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WizardStepSchema = Type.Object(
  {
    id: NonEmptyString,
    type: Type.Union([
      Type.Literal("note"),
      Type.Literal("select"),
      Type.Literal("text"),
      Type.Literal("confirm"),
      Type.Literal("multiselect"),
      Type.Literal("progress"),
      Type.Literal("action"),
    ]),
    title: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    options: Type.Optional(Type.Array(WizardStepOptionSchema)),
    initialValue: Type.Optional(Type.Unknown()),
    placeholder: Type.Optional(Type.String()),
    sensitive: Type.Optional(Type.Boolean()),
    executor: Type.Optional(Type.Union([Type.Literal("gateway"), Type.Literal("client")])),
  },
  { additionalProperties: false },
);

const WizardResultFields = {
  done: Type.Boolean(),
  step: Type.Optional(WizardStepSchema),
  status: Type.Optional(WizardRunStatusSchema),
  error: Type.Optional(Type.String()),
};

export const WizardNextResultSchema = Type.Object(WizardResultFields, {
  additionalProperties: false,
});

export const WizardStartResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    ...WizardResultFields,
  },
  { additionalProperties: false },
);

export const WizardStatusResultSchema = Type.Object(
  {
    status: WizardRunStatusSchema,
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
