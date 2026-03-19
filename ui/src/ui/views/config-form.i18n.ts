import { t } from "../../i18n/index.ts";

type TranslationLeaf = "label" | "help";

function normalizePathSegment(segment: string | number): string {
  if (typeof segment === "number") {
    return "*";
  }
  return segment.trim();
}

function wildcardMasks(length: number): number[] {
  if (length <= 1) {
    return [0];
  }
  const max = 1 << (length - 1);
  const masks = Array.from({ length: max }, (_, index) => index);
  masks.sort((a, b) => {
    const bitsA = a.toString(2).replaceAll("0", "").length;
    const bitsB = b.toString(2).replaceAll("0", "").length;
    return bitsA - bitsB;
  });
  return masks;
}

export function buildConfigFieldTranslationKeys(
  path: Array<string | number>,
  leaf: TranslationLeaf,
): string[] {
  const segments = path.map(normalizePathSegment).filter(Boolean);
  if (segments.length === 0) {
    return [];
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < segments.length; start += 1) {
    const suffix = segments.slice(start);
    for (const mask of wildcardMasks(suffix.length)) {
      const candidate = suffix.map((segment, index) =>
        index < suffix.length - 1 && (mask & (1 << index)) !== 0 ? "*" : segment,
      );
      const key = `config.fields.${candidate.join(".")}.${leaf}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function resolveConfigFieldTranslation(
  path: Array<string | number>,
  leaf: TranslationLeaf,
): string | undefined {
  for (const key of buildConfigFieldTranslationKeys(path, leaf)) {
    const value = t(key);
    if (value !== key) {
      return value;
    }
  }
  return undefined;
}
