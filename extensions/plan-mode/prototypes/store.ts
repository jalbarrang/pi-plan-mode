/**
 * Immutable prototype version storage — all paths are relative to taskman's
 * FileSystem runtime root, keeping prototype history with its owning plan.
 */

import { Data, Effect, Option } from "effect";
import { FileSystem, withFileLock, toKebabCase } from "@dreki-gg/taskman";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SLUG_LENGTH = 100;

export interface PrototypeVersion {
  version: number;
  file: string;
  intent: string;
  created_at: string;
}

export interface PrototypeManifest {
  schema_version: 1;
  plan: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
  versions: PrototypeVersion[];
}

export class PrototypeManifestError extends Data.TaggedError("PrototypeManifestError")<{
  path: string;
  reason: string;
}> {}

export class PrototypeVersionConflictError extends Data.TaggedError(
  "PrototypeVersionConflictError",
)<{
  path: string;
}> {}

export class PrototypeSlugError extends Data.TaggedError("PrototypeSlugError")<{
  value: string;
  reason: string;
}> {}

export function isValidPrototypeSlug(value: string): boolean {
  return (
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !value.includes("..") &&
    !value.includes("/")
  );
}

export function validatePrototypeSlug(value: string): string {
  if (!isValidPrototypeSlug(value)) {
    throw new PrototypeSlugError({
      value,
      reason: "must be lowercase kebab-case, at most 100 characters, and contain no path segments",
    });
  }
  return value;
}

export function normalizePrototypeSlug(value: string): string {
  const normalized = toKebabCase(value);
  return validatePrototypeSlug(normalized);
}

export function prototypeDir(plan: string, slug: string): string {
  return `${plan}/prototypes/${slug}`;
}

export function versionFileName(version: number): string {
  return `v${String(version).padStart(Math.max(3, String(version).length), "0")}.html`;
}

function manifestPath(plan: string, slug: string): string {
  return `${prototypeDir(plan, slug)}/manifest.json`;
}

function invalidManifest(path: string, reason: string): PrototypeManifestError {
  return new PrototypeManifestError({ path, reason });
}

function decodeManifest(value: unknown, path: string): PrototypeManifest | PrototypeManifestError {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidManifest(path, "manifest must be an object");
  const manifest = value as Partial<PrototypeManifest>;
  if (manifest.schema_version !== 1)
    return invalidManifest(path, "unsupported or missing schema_version");
  if (typeof manifest.plan !== "string" || !isValidPrototypeSlug(manifest.plan))
    return invalidManifest(path, "invalid plan");
  if (typeof manifest.slug !== "string" || !isValidPrototypeSlug(manifest.slug))
    return invalidManifest(path, "invalid slug");
  if (
    typeof manifest.title !== "string" ||
    typeof manifest.created_at !== "string" ||
    typeof manifest.updated_at !== "string"
  ) {
    return invalidManifest(path, "invalid metadata");
  }
  if (
    typeof manifest.latest_version !== "number" ||
    !Number.isSafeInteger(manifest.latest_version) ||
    manifest.latest_version < 1 ||
    !Array.isArray(manifest.versions)
  ) {
    return invalidManifest(path, "invalid version metadata");
  }

  const latestVersion = manifest.latest_version;
  let previousVersion = 0;
  for (const entry of manifest.versions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return invalidManifest(path, "invalid version entry");
    const version = entry as Partial<PrototypeVersion>;
    if (
      !Number.isSafeInteger(version.version) ||
      version.version !== previousVersion + 1 ||
      version.file !== versionFileName(version.version) ||
      typeof version.intent !== "string" ||
      typeof version.created_at !== "string"
    ) {
      return invalidManifest(path, "invalid version entry");
    }
    previousVersion = version.version;
  }
  if (previousVersion !== latestVersion)
    return invalidManifest(path, "latest_version does not match versions");

  return manifest as PrototypeManifest;
}

function parseManifest(text: string, path: string): PrototypeManifest | PrototypeManifestError {
  try {
    return decodeManifest(JSON.parse(text), path);
  } catch {
    return invalidManifest(path, "invalid JSON");
  }
}

function normalizePlan(plan: string): string {
  return normalizePrototypeSlug(plan);
}

export function readPrototypeManifest(plan: string, slug: string) {
  return Effect.gen(function* () {
    const normalizedPlan = normalizePlan(plan);
    const normalizedSlug = validatePrototypeSlug(slug);
    const path = manifestPath(normalizedPlan, normalizedSlug);
    const fs = yield* FileSystem;
    const parsed = parseManifest(yield* fs.readFileString(path), path);
    if (parsed instanceof PrototypeManifestError) return yield* Effect.fail(parsed);
    if (parsed.plan !== normalizedPlan || parsed.slug !== normalizedSlug) {
      return yield* Effect.fail(
        invalidManifest(path, "manifest identity does not match its location"),
      );
    }
    return parsed;
  });
}

export function readPrototypeVersion(plan: string, slug: string, version: number) {
  return Effect.gen(function* () {
    if (!Number.isSafeInteger(version) || version < 1) {
      return yield* Effect.fail(
        new PrototypeManifestError({ path: String(version), reason: "invalid version" }),
      );
    }
    const manifest = yield* readPrototypeManifest(plan, slug);
    const entry = manifest.versions.find((candidate) => candidate.version === version);
    if (!entry) {
      return yield* Effect.fail(
        new PrototypeManifestError({
          path: manifestPath(manifest.plan, manifest.slug),
          reason: `version ${version} is not present`,
        }),
      );
    }
    const fs = yield* FileSystem;
    return yield* fs.readFileString(`${prototypeDir(manifest.plan, manifest.slug)}/${entry.file}`);
  });
}

export function publishPrototypeVersion(input: {
  plan: string;
  slug: string;
  title: string;
  intent: string;
  html: string;
}) {
  return Effect.gen(function* () {
    const plan = normalizePlan(input.plan);
    const slug = validatePrototypeSlug(input.slug);
    const dir = prototypeDir(plan, slug);
    const path = manifestPath(plan, slug);

    return yield* withFileLock(
      `prototype:${plan}/${slug}`,
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const existing = yield* Effect.option(fs.readFileString(path));
        let previous: PrototypeManifest | undefined;
        if (Option.isSome(existing)) {
          const parsed = parseManifest(existing.value, path);
          if (parsed instanceof PrototypeManifestError) return yield* Effect.fail(parsed);
          if (parsed.plan !== plan || parsed.slug !== slug) {
            return yield* Effect.fail(
              invalidManifest(path, "manifest identity does not match its location"),
            );
          }
          previous = parsed;
        }

        const version = (previous?.latest_version ?? 0) + 1;
        const file = versionFileName(version);
        const targetPath = `${dir}/${file}`;
        const target = yield* Effect.option(fs.readFileString(targetPath));
        if (Option.isSome(target))
          return yield* Effect.fail(new PrototypeVersionConflictError({ path: targetPath }));

        const now = new Date().toISOString();
        const entry: PrototypeVersion = { version, file, intent: input.intent, created_at: now };
        const manifest: PrototypeManifest = previous
          ? {
              ...previous,
              title: input.title,
              updated_at: now,
              latest_version: version,
              versions: [...previous.versions, entry],
            }
          : {
              schema_version: 1,
              plan,
              slug,
              title: input.title,
              created_at: now,
              updated_at: now,
              latest_version: version,
              versions: [entry],
            };

        yield* fs.makeDir(dir);
        yield* fs.writeFileString(targetPath, input.html);
        yield* fs.writeFileAtomic(path, JSON.stringify(manifest, null, 2) + "\n");
        return manifest;
      }),
    );
  });
}

export function listPrototypes(plan?: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const plans = plan ? [normalizePlan(plan)] : yield* Effect.option(fs.listDirectories("."));
    const planNames = Array.isArray(plans) ? plans : Option.isSome(plans) ? plans.value : [];
    const manifests: PrototypeManifest[] = [];

    for (const planName of planNames) {
      if (
        !plan &&
        (planName === ".archive" || planName === "_prototypes" || !isValidPrototypeSlug(planName))
      )
        continue;
      const prototypeSlugs = yield* Effect.option(fs.listDirectories(`${planName}/prototypes`));
      if (Option.isNone(prototypeSlugs)) continue;
      for (const slug of prototypeSlugs.value) {
        if (!isValidPrototypeSlug(slug)) continue;
        const path = manifestPath(planName, slug);
        const text = yield* Effect.option(fs.readFileString(path));
        if (Option.isNone(text)) continue;
        const manifest = parseManifest(text.value, path);
        if (
          manifest instanceof PrototypeManifestError ||
          manifest.plan !== planName ||
          manifest.slug !== slug
        )
          continue;
        manifests.push(manifest);
      }
    }
    return manifests.sort(
      (left, right) => left.plan.localeCompare(right.plan) || left.slug.localeCompare(right.slug),
    );
  });
}
