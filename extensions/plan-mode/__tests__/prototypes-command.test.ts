import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir } from "node:process";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
  PrototypeRef,
  PrototypeSummary,
  PrototypeWorkspace,
} from "../prototypes/workspace.js";
import { handlePrototypes } from "../commands/prototypes.js";

const originalCwd = process.cwd();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plan-mode-prototypes-command-"));
  chdir(dir);
});

afterEach(async () => {
  chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

const prototypes: PrototypeSummary[] = [
  {
    plan: "alpha-plan",
    slug: "first",
    title: "First",
    latestVersion: 1,
    latestIntent: "First intent",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    plan: "beta-plan",
    slug: "second",
    title: "Second",
    latestVersion: 2,
    latestIntent: "Second intent",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

function setup(options: { list?: PrototypeSummary[]; select?: string | null | undefined } = {}) {
  const notifications: Array<[string, string]> = [];
  const selections: Array<[string, string[]]> = [];
  const opened: PrototypeRef[] = [];
  const listCalls: Array<string | undefined> = [];
  const workspace: PrototypeWorkspace = {
    publish: async () => {
      throw new Error("not used");
    },
    list: async (plan) => {
      listCalls.push(plan);
      return options.list ?? prototypes;
    },
    open: async (ref) => {
      opened.push(ref);
      return { url: `http://127.0.0.1:1234/${ref.plan}/${ref.slug}` };
    },
    close: async () => {},
  };
  const ctx = {
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      select: async (message: string, labels: string[]) => {
        selections.push([message, labels]);
        return options.select;
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, workspace, notifications, selections, opened, listCalls };
}

describe("/prototypes", () => {
  test("notifies when no prototypes exist", async () => {
    const { ctx, workspace, notifications } = setup({ list: [] });

    await handlePrototypes(ctx, workspace, undefined);

    expect(notifications[0]?.[0]).toContain("No prototypes");
  });

  test("opens one prototype directly", async () => {
    const { ctx, workspace, opened, selections, notifications } = setup({ list: [prototypes[0]] });

    await handlePrototypes(ctx, workspace, undefined);

    expect(opened).toEqual([expect.objectContaining({ plan: "alpha-plan", slug: "first" })]);
    expect(selections).toHaveLength(0);
    expect(notifications[0]?.[0]).toContain("http://127.0.0.1:1234/alpha-plan/first");
  });

  test("selects and opens the chosen prototype", async () => {
    const selected = "Second — beta-plan (v2, 2026-01-02T00:00:00.000Z)";
    const { ctx, workspace, opened, selections } = setup({ select: selected });

    await handlePrototypes(ctx, workspace, undefined);

    expect(selections).toEqual([
      [
        "Open a prototype:",
        [
          "First — alpha-plan (v1, 2026-01-01T00:00:00.000Z)",
          "Second — beta-plan (v2, 2026-01-02T00:00:00.000Z)",
        ],
      ],
    ]);
    expect(opened).toEqual([expect.objectContaining({ plan: "beta-plan", slug: "second" })]);
  });

  test("does not open a prototype when selection is cancelled", async () => {
    const { ctx, workspace, opened } = setup({ select: undefined });

    await handlePrototypes(ctx, workspace, undefined);

    expect(opened).toHaveLength(0);
  });

  test("normalizes a plan argument before listing", async () => {
    const { ctx, workspace, listCalls } = setup({ list: [] });

    await handlePrototypes(ctx, workspace, "  Alpha Plan  ");

    expect(listCalls).toEqual(["alpha-plan"]);
  });
});
