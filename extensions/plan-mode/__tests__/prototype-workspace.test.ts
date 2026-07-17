/** Integration coverage for the loopback prototype workspace, viewer, and SSE routes. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chdir } from "node:process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PLANS_ROOT, makePlanRuntime } from "@dreki-gg/taskman";
import { createPrototypeWorkspace, type PrototypeWorkspace } from "../prototypes/workspace.js";

const runPlanIO = makePlanRuntime();
const originalCwd = process.cwd();
let dir: string;
let workspaces: PrototypeWorkspace[];

function createWorkspace(opener: (url: string) => void = () => {}) {
  const workspace = createPrototypeWorkspace({
    runPlanIO,
    plansRoot: DEFAULT_PLANS_ROOT,
    openExternal: opener,
  });
  workspaces.push(workspace);
  return workspace;
}

function publish(workspace: PrototypeWorkspace, overrides: Record<string, string> = {}) {
  return workspace.publish({
    plan: "demo-plan",
    title: "Viewer",
    intent: "Show the first state",
    html: "<h1>first</h1>",
    ...overrides,
  });
}

async function readVersionEvent(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no body");
  const decoder = new TextDecoder();
  let text = "";
  while (!signal.aborted) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("SSE deadline exceeded")), {
          once: true,
        }),
      ),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
    if (text.includes("event: version")) return text;
  }
  throw new Error("SSE deadline exceeded");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plan-mode-prototype-workspace-"));
  workspaces = [];
  chdir(dir);
});

afterEach(async () => {
  await Promise.all(workspaces.map((workspace) => workspace.close()));
  chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

describe("prototype workspace", () => {
  test("opens only the first publish for a ref and keeps its viewer URL", async () => {
    const opened: string[] = [];
    const workspace = createWorkspace((url) => opened.push(url));

    const first = await publish(workspace);
    const second = await publish(workspace, {
      intent: "Show the revised state",
      html: "<h1>second</h1>",
    });

    expect(first).toMatchObject({ version: 1, opened: true, latestVersion: 1 });
    expect(second).toMatchObject({ version: 2, opened: false, latestVersion: 2 });
    expect(first.url).toBe(second.url);
    expect(opened).toEqual([first.url]);
    expect(second.versionFilePath).toBe(
      `${DEFAULT_PLANS_ROOT}/demo-plan/prototypes/viewer/v002.html`,
    );
  });

  test("serves the viewer, manifest, and exact version bytes with restrictive headers", async () => {
    const workspace = createWorkspace();
    const published = await publish(workspace, { html: "<!doctype html><h1>stored bytes</h1>" });

    const viewer = await fetch(published.url);
    const viewerHtml = await viewer.text();
    expect(viewer.status).toBe(200);
    expect(viewerHtml).toContain('sandbox="allow-scripts');
    expect(viewerHtml).not.toContain("allow-same-origin");
    expect(viewer.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
    );

    const manifest = await fetch(`${published.url}manifest.json`);
    expect(manifest.headers.get("cache-control")).toBe("no-store");
    await expect(manifest.json()).resolves.toMatchObject({ latest_version: 1 });

    const version = await fetch(`${published.url}v/1`);
    expect(await version.text()).toBe("<!doctype html><h1>stored bytes</h1>");
    expect(version.headers.get("x-content-type-options")).toBe("nosniff");
    expect(version.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  test("broadcasts a version SSE event to the matching prototype", async () => {
    const workspace = createWorkspace();
    const first = await publish(workspace);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    timeout.unref();
    try {
      const events = await fetch(`${first.url}events`, { signal: controller.signal });
      expect(events.status).toBe(200);
      const received = readVersionEvent(events, controller.signal);
      await publish(workspace, { html: "<h1>second</h1>" });
      const text = await received;
      expect(text).toContain("event: version");
      expect(text).toContain('"latest":2');
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  });

  test("rejects invalid tokens, traversal, invalid refs, unknown versions, and non-GET requests", async () => {
    const workspace = createWorkspace();
    const published = await publish(workspace);
    const url = new URL(published.url);
    const token = url.pathname.split("/")[2];
    const wrongToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    const base = `${url.protocol}//${url.host}`;

    for (const target of [
      `${base}/t/${wrongToken}/p/demo-plan/viewer/`,
      `${base}/t/short/p/demo-plan/viewer/`,
      `${base}/t/${token}/p/../../etc/passwd`,
      `${base}/t/${token}/p/%2e%2e/viewer/`,
      `${base}/t/${token}/p/demo-plan/not_valid/`,
      `${published.url}v/99`,
    ]) {
      expect((await fetch(target)).status).toBe(404);
    }
    expect((await fetch(published.url, { method: "POST" })).status).not.toBe(200);
  });

  test("open always invokes its opener and rejects a missing ref", async () => {
    const opened: string[] = [];
    const workspace = createWorkspace((url) => opened.push(url));
    const published = await publish(workspace);

    const openedResult = await workspace.open({ plan: "demo-plan", slug: "viewer" });
    expect(openedResult.url).toBe(published.url);
    expect(opened).toEqual([published.url, published.url]);
    await expect(workspace.open({ plan: "demo-plan", slug: "missing" })).rejects.toThrow();
  });

  test("close is idempotent and a later publish starts a fresh server and reopens", async () => {
    const opened: string[] = [];
    const workspace = createWorkspace((url) => opened.push(url));
    const first = await publish(workspace);
    await workspace.close();
    await workspace.close();
    const second = await publish(workspace, { html: "<h1>second</h1>" });

    expect(second.version).toBe(2);
    expect(new URL(second.url).port).not.toBe(new URL(first.url).port);
    // The old URL died with the old server, so the fresh URL opens again.
    expect(second.opened).toBe(true);
    expect(opened).toEqual([first.url, second.url]);
  });
});
