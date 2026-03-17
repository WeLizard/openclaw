import { pathKey, schemaType, type JsonSchema } from "./config-form.shared.ts";

export type ConfigSchemaAnalysis = {
  schema: JsonSchema | null;
  unsupportedPaths: string[];
};

const META_KEYS = new Set(["title", "description", "default", "nullable"]);

function isAnySchema(schema: JsonSchema): boolean {
  const keys = Object.keys(schema ?? {}).filter((key) => !META_KEYS.has(key));
  return keys.length === 0;
}

function normalizeEnum(values: unknown[]): { enumValues: unknown[]; nullable: boolean } {
  const filtered = values.filter((value) => value != null);
  const nullable = filtered.length !== values.length;
  const enumValues: unknown[] = [];
  for (const value of filtered) {
    if (!enumValues.some((existing) => Object.is(existing, value))) {
      enumValues.push(value);
    }
  }
  return { enumValues, nullable };
}

export function analyzeConfigSchema(raw: unknown): ConfigSchemaAnalysis {
  if (!raw || typeof raw !== "object") {
    return { schema: null, unsupportedPaths: ["<root>"] };
  }
  return normalizeSchemaNode(raw as JsonSchema, []);
}

function normalizeSchemaNode(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis {
  const unsupported = new Set<string>();
  const normalized: JsonSchema = { ...schema };
  const pathLabel = pathKey(path) || "<root>";

  if (path.length > 0 && isAnySchema(schema)) {
    return {
      schema: {
        ...schema,
        type: "string",
      },
      unsupportedPaths: [],
    };
  }

  if (schema.allOf) {
    const composed = normalizeAllOf(schema, path);
    if (composed) {
      return composed;
    }
    return { schema, unsupportedPaths: [pathLabel] };
  }

  if (schema.anyOf || schema.oneOf) {
    const union = normalizeUnion(schema, path);
    if (union) {
      return union;
    }
    return { schema, unsupportedPaths: [pathLabel] };
  }

  const nullable = Array.isArray(schema.type) && schema.type.includes("null");
  const type =
    schemaType(schema) ?? (schema.properties || schema.additionalProperties ? "object" : undefined);
  normalized.type = type ?? schema.type;
  normalized.nullable = nullable || schema.nullable;

  if (normalized.enum) {
    const { enumValues, nullable: enumNullable } = normalizeEnum(normalized.enum);
    normalized.enum = enumValues;
    if (enumNullable) {
      normalized.nullable = true;
    }
    if (enumValues.length === 0) {
      unsupported.add(pathLabel);
    }
  }

  if (type === "object") {
    const properties = schema.properties ?? {};
    const normalizedProps: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(properties)) {
      const res = normalizeSchemaNode(value, [...path, key]);
      if (res.schema) {
        normalizedProps[key] = res.schema;
      }
      for (const entry of res.unsupportedPaths) {
        unsupported.add(entry);
      }
    }
    normalized.properties = normalizedProps;

    if (schema.additionalProperties === true) {
      // Treat `true` as an untyped map schema so dynamic object keys can still be edited.
      normalized.additionalProperties = {};
    } else if (schema.additionalProperties === false) {
      normalized.additionalProperties = false;
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      if (!isAnySchema(schema.additionalProperties)) {
        const res = normalizeSchemaNode(schema.additionalProperties, [...path, "*"]);
        normalized.additionalProperties = res.schema ?? schema.additionalProperties;
        if (!res.schema) {
          unsupported.add(pathLabel);
        }
        for (const entry of res.unsupportedPaths) {
          unsupported.add(entry);
        }
      }
    }
  } else if (type === "array") {
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (!itemsSchema) {
      unsupported.add(pathLabel);
    } else {
      const res = normalizeSchemaNode(itemsSchema, [...path, "*"]);
      normalized.items = res.schema ?? itemsSchema;
      if (!res.schema) {
        unsupported.add(pathLabel);
      }
      for (const entry of res.unsupportedPaths) {
        unsupported.add(entry);
      }
    }
  } else if (
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    !normalized.enum
  ) {
    unsupported.add(pathLabel);
  }

  return {
    schema: normalized,
    unsupportedPaths: Array.from(unsupported),
  };
}

function mergeAdditionalProperties(
  current: JsonSchema["additionalProperties"],
  next: JsonSchema["additionalProperties"],
): JsonSchema["additionalProperties"] {
  if (next === undefined) {
    return current;
  }
  if (current === undefined) {
    return next;
  }
  if (current === false || next === false) {
    return false;
  }
  if (current === true || next === true) {
    return true;
  }
  return {
    ...current,
    ...next,
    ...(current.properties || next.properties
      ? { properties: { ...(current.properties ?? {}), ...(next.properties ?? {}) } }
      : {}),
  };
}

function normalizeAllOf(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis | null {
  const segments = schema.allOf ?? [];
  if (segments.length === 0) {
    return null;
  }

  const merged: JsonSchema = { ...schema, allOf: undefined };
  const unsupported = new Set<string>();

  for (const segment of segments) {
    if (!segment || typeof segment !== "object") {
      return null;
    }
    const res = normalizeSchemaNode(segment, path);
    if (!res.schema) {
      return null;
    }
    for (const entry of res.unsupportedPaths) {
      unsupported.add(entry);
    }

    const segmentSchema = res.schema;
    const mergedType = schemaType(merged);
    const segmentType = schemaType(segmentSchema);
    if (mergedType && segmentType && mergedType !== segmentType) {
      return null;
    }

    merged.type = mergedType ?? segmentType ?? merged.type;
    merged.nullable = Boolean(merged.nullable || segmentSchema.nullable);
    merged.title = merged.title ?? segmentSchema.title;
    merged.description = merged.description ?? segmentSchema.description;
    merged.default = merged.default ?? segmentSchema.default;
    if (segmentSchema.enum && !merged.enum) {
      merged.enum = segmentSchema.enum;
    }
    if (segmentSchema.items && !merged.items) {
      merged.items = segmentSchema.items;
    }
    if (segmentSchema.properties) {
      merged.properties = {
        ...(merged.properties ?? {}),
        ...segmentSchema.properties,
      };
    }
    merged.additionalProperties = mergeAdditionalProperties(
      merged.additionalProperties,
      segmentSchema.additionalProperties,
    );
  }

  const normalized = normalizeSchemaNode(merged, path);
  for (const entry of unsupported) {
    if (!normalized.unsupportedPaths.includes(entry)) {
      normalized.unsupportedPaths.push(entry);
    }
  }
  return normalized;
}

function isSecretRefVariant(entry: JsonSchema): boolean {
  if (schemaType(entry) !== "object") {
    return false;
  }
  const source = entry.properties?.source;
  const provider = entry.properties?.provider;
  const id = entry.properties?.id;
  if (!source || !provider || !id) {
    return false;
  }
  return (
    typeof source.const === "string" &&
    schemaType(provider) === "string" &&
    schemaType(id) === "string"
  );
}

function isSecretRefUnion(entry: JsonSchema): boolean {
  const variants = entry.oneOf ?? entry.anyOf;
  if (!variants || variants.length === 0) {
    return false;
  }
  return variants.every((variant) => isSecretRefVariant(variant));
}

function normalizeSecretInputUnion(
  schema: JsonSchema,
  path: Array<string | number>,
  remaining: JsonSchema[],
  nullable: boolean,
): ConfigSchemaAnalysis | null {
  const stringIndex = remaining.findIndex((entry) => schemaType(entry) === "string");
  if (stringIndex < 0) {
    return null;
  }
  const nonString = remaining.filter((_, index) => index !== stringIndex);
  if (nonString.length !== 1 || !isSecretRefUnion(nonString[0])) {
    return null;
  }
  return normalizeSchemaNode(
    {
      ...schema,
      ...remaining[stringIndex],
      nullable,
      anyOf: undefined,
      oneOf: undefined,
      allOf: undefined,
    },
    path,
  );
}

function normalizeUnion(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis | null {
  if (schema.allOf) {
    return null;
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (!union) {
    return null;
  }

  const literals: unknown[] = [];
  const remaining: JsonSchema[] = [];
  let nullable = false;

  for (const entry of union) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    if (Array.isArray(entry.enum)) {
      const { enumValues, nullable: enumNullable } = normalizeEnum(entry.enum);
      literals.push(...enumValues);
      if (enumNullable) {
        nullable = true;
      }
      continue;
    }
    if ("const" in entry) {
      if (entry.const == null) {
        nullable = true;
        continue;
      }
      literals.push(entry.const);
      continue;
    }
    if (schemaType(entry) === "null") {
      nullable = true;
      continue;
    }
    remaining.push(entry);
  }

  // Config secrets accept either a raw key string or a structured secret ref object.
  // The form only supports editing the string path for now.
  const secretInput = normalizeSecretInputUnion(schema, path, remaining, nullable);
  if (secretInput) {
    return secretInput;
  }

  if (literals.length > 0 && remaining.length === 0) {
    const unique: unknown[] = [];
    for (const value of literals) {
      if (!unique.some((existing) => Object.is(existing, value))) {
        unique.push(value);
      }
    }
    return {
      schema: {
        ...schema,
        enum: unique,
        nullable,
        anyOf: undefined,
        oneOf: undefined,
        allOf: undefined,
      },
      unsupportedPaths: [],
    };
  }

  if (remaining.length === 1) {
    const res = normalizeSchemaNode(remaining[0], path);
    if (res.schema) {
      res.schema.nullable = nullable || res.schema.nullable;
    }
    return res;
  }

  const renderableUnionTypes = new Set([
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
  ]);
  if (
    remaining.length > 0 &&
    literals.length === 0 &&
    remaining.every((entry) => {
      const type = schemaType(entry);
      return Boolean(type) && renderableUnionTypes.has(String(type));
    })
  ) {
    return {
      schema: {
        ...schema,
        nullable,
      },
      unsupportedPaths: [],
    };
  }

  const normalizedVariants = remaining
    .map((entry) => {
      const res = normalizeSchemaNode(entry, path);
      if (!res.schema) {
        return null;
      }
      return res;
    })
    .filter((entry): entry is ConfigSchemaAnalysis => Boolean(entry));
  if (normalizedVariants.length === remaining.length && normalizedVariants.length > 1) {
    const unsupportedPaths = new Set<string>();
    for (const variant of normalizedVariants) {
      for (const entry of variant.unsupportedPaths) {
        unsupportedPaths.add(entry);
      }
    }
    return {
      schema: {
        ...schema,
        nullable,
        anyOf: schema.anyOf ? normalizedVariants.map((variant) => variant.schema!) : undefined,
        oneOf: schema.oneOf ? normalizedVariants.map((variant) => variant.schema!) : undefined,
        allOf: undefined,
      },
      unsupportedPaths: Array.from(unsupportedPaths),
    };
  }

  return null;
}
