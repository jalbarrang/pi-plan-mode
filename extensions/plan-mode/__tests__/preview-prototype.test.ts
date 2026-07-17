import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir } from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PublishedPrototype, PrototypeWorkspace } from "../prototypes/workspace.js";
import { registerPreviewPrototypeTool } from "../tools/preview-prototype.js";

interface PreviewParams {
  plan: string;
  title: string;
  intent: string;
  html: string;
}

interface CapturedTool {
  parameters: { required?: string[] };
  execute: (
    id: string,
    params: PreviewParams,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: { ui?: { notify: (message: string, level: "info" | "error") => void } },
  ) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
}

const originalCwd = process.cwd();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plan-mode-preview-prototype-"));
  chdir(dir);
});

afterEach(async () => {
  chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

function published(overrides: Partial<PublishedPrototype> = {}): PublishedPrototype {
  return {
    plan: "artifact-style",
    slug: "review",
    title: "Review",
    latestVersion: 1,
    latestIntent: "Review the design",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    versionFilePath: ".taskman/plans/artifact-style/prototypes/review/v001.html",
    url: "http://127.0.0.1:1234/t/token/p/artifact-style/review/",
    opened: true,
    ...overrides,
  };
}

function setup(result: PublishedPrototype | Error = published()) {
  const calls: Array<{ plan: string; title: string; intent: string; html: string }> = [];
  const workspace: PrototypeWorkspace = {
    publish: async (input) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
    list: async () => [],
    open: async () => ({ url: "http://localhost/" }),
    close: async () => {},
  };
  let tool: CapturedTool | undefined;
  const pi = {
    registerTool: (config: CapturedTool) => {
      tool = config;
    },
  } as unknown as ExtensionAPI;
  registerPreviewPrototypeTool(pi, workspace);
  return { tool: tool!, calls };
}

const params: PreviewParams = {
  plan: "artifact-style",
  title: "Review",
  intent: "Review the design",
  html: "<main>Prototype</main>",
};

describe("preview_prototype tool", () => {
  test("requires plan and publishes a wrapped fragment to the workspace", async () => {
    const { tool, calls } = setup();
    expect(tool.parameters.required).toContain("plan");

    const result = await tool.execute("call", params);

    expect(calls).toEqual([
      expect.objectContaining({
        plan: "artifact-style",
        html: expect.stringContaining("<!doctype html>"),
      }),
    ]);
    expect(result.content[0].text).toContain("http://127.0.0.1:1234");
    expect(result.details).toEqual({
      url: "http://127.0.0.1:1234/t/token/p/artifact-style/review/",
      plan: "artifact-style",
      slug: "review",
      version: 1,
      filePath: ".taskman/plans/artifact-style/prototypes/review/v001.html",
      opened: true,
    });
  });

  test("preserves a full document and reports in-place updates", async () => {
    const { tool, calls } = setup(published({ version: 2, opened: false }));
    const html = "<!doctype html><html><body>Complete</body></html>";

    const result = await tool.execute("call", { ...params, html });

    expect(calls[0]?.html).toBe(html);
    expect(result.content[0].text).toContain("updated in place to v2");
    expect(result.content[0].text).toContain("no new tab opened");
  });

  test("surfaces workspace publish errors", async () => {
    const { tool } = setup(new Error("Prototype plan and title must not be empty"));

    await expect(tool.execute("call", params)).rejects.toThrow(
      "Prototype plan and title must not be empty",
    );
  });
});
