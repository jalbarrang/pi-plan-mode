/**
 * Prototype persistence coverage — each test runs taskman's filesystem runtime
 * against an isolated temporary ledger root.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chdir } from "node:process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PLANS_ROOT, makePlanRuntime } from "@dreki-gg/taskman";
import {
  listPrototypes,
  publishPrototypeVersion,
  readPrototypeManifest,
  readPrototypeVersion,
  versionFileName,
} from "../prototypes/store.js";

const runPlanIO = makePlanRuntime();
const originalCwd = process.cwd();
let dir: string;

function publish(overrides: Partial<Parameters<typeof publishPrototypeVersion>[0]> = {}) {
  return runPlanIO(
    publishPrototypeVersion({
      plan: "demo-plan",
      slug: "viewer",
      title: "Viewer",
      intent: "Show the first state",
      html: "<h1>first</h1>",
      ...overrides,
    }),
  );
}

function prototypePath(plan = "demo-plan", slug = "viewer"): string {
  return join(dir, DEFAULT_PLANS_ROOT, plan, "prototypes", slug);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plan-mode-prototype-store-"));
  chdir(dir);
});

afterEach(async () => {
  chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

describe("prototype store", () => {
  test("first publish creates v001.html and a schema version 1 manifest", async () => {
    const manifest = await publish();

    expect(manifest.schema_version).toBe(1);
    expect(manifest.latest_version).toBe(1);
    expect(manifest.versions).toEqual([
      expect.objectContaining({ version: 1, file: "v001.html", intent: "Show the first state" }),
    ]);
    expect(await readFile(join(prototypePath(), "v001.html"), "utf8")).toBe("<h1>first</h1>");
    expect(JSON.parse(await readFile(join(prototypePath(), "manifest.json"), "utf8"))).toEqual(
      manifest,
    );
  });

  test("second publish preserves v001 bytes and records each version intent", async () => {
    await publish();
    await publish({ intent: "Show the revised state", html: "<h1>second</h1>" });

    const manifest = await runPlanIO(readPrototypeManifest("demo-plan", "viewer"));
    expect(await readFile(join(prototypePath(), "v001.html"), "utf8")).toBe("<h1>first</h1>");
    expect(await readFile(join(prototypePath(), "v002.html"), "utf8")).toBe("<h1>second</h1>");
    expect(manifest.versions.map(({ version, intent }) => ({ version, intent }))).toEqual([
      { version: 1, intent: "Show the first state" },
      { version: 2, intent: "Show the revised state" },
    ]);
    expect(await runPlanIO(readPrototypeVersion("demo-plan", "viewer", 1))).toBe("<h1>first</h1>");
  });

  test("concurrent publishes allocate distinct immutable versions", async () => {
    await Promise.all([publish({ html: "<h1>one</h1>" }), publish({ html: "<h1>two</h1>" })]);

    const manifest = await runPlanIO(readPrototypeManifest("demo-plan", "viewer"));
    expect(manifest.versions.map(({ version }) => version)).toEqual([1, 2]);
    expect(
      await Promise.all([
        readFile(join(prototypePath(), "v001.html"), "utf8"),
        readFile(join(prototypePath(), "v002.html"), "utf8"),
      ]),
    ).toEqual(expect.arrayContaining(["<h1>one</h1>", "<h1>two</h1>"]));
  });

  test("a corrupt manifest fails loudly and writes no new version", async () => {
    await publish();
    await writeFile(join(prototypePath(), "manifest.json"), "{not json");
    const before = await readdir(prototypePath());

    await expect(publish({ html: "<h1>never</h1>" })).rejects.toThrow();
    expect(await readdir(prototypePath())).toEqual(before);
  });

  test("a pre-existing target version file fails without overwrite", async () => {
    await mkdir(prototypePath(), { recursive: true });
    await writeFile(join(prototypePath(), "v001.html"), "already here");

    await expect(publish()).rejects.toThrow();
    expect(await readFile(join(prototypePath(), "v001.html"), "utf8")).toBe("already here");
  });

  test("listPrototypes filters by normalized plan", async () => {
    await publish({ plan: "first-plan", slug: "first" });
    await publish({ plan: "second-plan", slug: "second" });

    const prototypes = await runPlanIO(listPrototypes("First Plan"));
    expect(prototypes.map(({ plan, slug }) => ({ plan, slug }))).toEqual([
      { plan: "first-plan", slug: "first" },
    ]);
  });

  test("broad list skips corrupt, legacy, and non-prototype directories", async () => {
    await publish({ plan: "valid-plan", slug: "valid" });
    await mkdir(join(dir, DEFAULT_PLANS_ROOT, ".archive", "prototypes", "ignored"), {
      recursive: true,
    });
    await mkdir(join(dir, DEFAULT_PLANS_ROOT, "_prototypes", "ignored"), { recursive: true });
    await mkdir(join(dir, DEFAULT_PLANS_ROOT, "empty-plan"), { recursive: true });
    await mkdir(join(dir, DEFAULT_PLANS_ROOT, "corrupt-plan", "prototypes", "broken"), {
      recursive: true,
    });
    await writeFile(
      join(dir, DEFAULT_PLANS_ROOT, "corrupt-plan", "prototypes", "broken", "manifest.json"),
      "{nope",
    );

    const prototypes = await runPlanIO(listPrototypes());
    expect(prototypes.map(({ plan, slug }) => ({ plan, slug }))).toEqual([
      { plan: "valid-plan", slug: "valid" },
    ]);
  });

  test.each(["../x", "a/b", "", "UPPER"])(
    "slug validation rejects %p before storage access",
    async (slug) => {
      await expect(publish({ slug })).rejects.toThrow();
      await expect(
        readFile(
          join(dir, DEFAULT_PLANS_ROOT, "demo-plan", "prototypes", slug, "manifest.json"),
          "utf8",
        ),
      ).rejects.toThrow();
    },
  );

  test("version filenames pad through three digits and grow beyond them", () => {
    expect(versionFileName(1)).toBe("v001.html");
    expect(versionFileName(1000)).toBe("v1000.html");
  });
});
