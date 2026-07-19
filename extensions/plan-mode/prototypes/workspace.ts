/** Public prototype workspace seam: storage, local serving, and browser-opening policy. */

import { spawn } from "node:child_process";
import { toKebabCase, type RunPlanIO } from "@dreki-gg/taskman";
import {
  listPrototypes,
  normalizePrototypeSlug,
  publishPrototypeVersion,
  readPrototypeManifest,
  validatePrototypeSlug,
  type PrototypeManifest,
} from "./store.js";
import { createPrototypeServer, type PrototypeServer } from "./server.js";

export interface PrototypeRef {
  plan: string;
  slug: string;
}

export interface PrototypeSummary extends PrototypeRef {
  title: string;
  latestVersion: number;
  latestIntent: string;
  updatedAt: string;
}

export interface PublishedPrototype extends PrototypeSummary {
  version: number;
  versionFilePath: string;
  url: string;
  opened: boolean;
}

export interface PrototypeWorkspace {
  publish(input: {
    plan: string;
    title: string;
    intent: string;
    html: string;
  }): Promise<PublishedPrototype>;
  list(plan?: string): Promise<PrototypeSummary[]>;
  open(ref: PrototypeRef): Promise<{ url: string }>;
  startServer(): Promise<{ port: number }>;
  stopServer(): Promise<{ wasRunning: boolean }>;
  serverStatus(): { running: boolean; port?: number };
  close(): Promise<void>;
}

export type ExternalOpener = (url: string) => void;

/** Best-effort open of a local viewer URL in the OS default browser. */
function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening is a convenience — ignore failures in headless or sandboxed environments.
  }
}

function normalizeRef(ref: PrototypeRef): PrototypeRef {
  const plan = toKebabCase(ref.plan);
  if (!plan || !ref.slug) throw new Error("Prototype plan and slug must not be empty");
  return { plan: normalizePrototypeSlug(plan), slug: validatePrototypeSlug(ref.slug) };
}

function toSummary(manifest: PrototypeManifest): PrototypeSummary {
  const latest = manifest.versions.at(-1);
  if (!latest) throw new Error("Prototype manifest has no versions");
  return {
    plan: manifest.plan,
    slug: manifest.slug,
    title: manifest.title,
    latestVersion: manifest.latest_version,
    latestIntent: latest.intent,
    updatedAt: manifest.updated_at,
  };
}

export function createPrototypeWorkspace(options: {
  runPlanIO: RunPlanIO;
  plansRoot: string;
  openExternal?: ExternalOpener;
}): PrototypeWorkspace {
  let server: PrototypeServer | undefined;
  let starting: Promise<PrototypeServer> | undefined;
  const openedRefs = new Set<string>();
  const openExternal = options.openExternal ?? openInBrowser;

  async function ensureServer(): Promise<PrototypeServer> {
    if (server) return server;
    if (!starting) {
      const next = createPrototypeServer({ runPlanIO: options.runPlanIO });
      starting = next
        .start()
        .then(() => {
          server = next;
          return next;
        })
        .finally(() => {
          starting = undefined;
        });
    }
    return starting;
  }

  function openedKey(ref: PrototypeRef): string {
    return `${ref.plan}/${ref.slug}`;
  }

  function serverStatus(): { running: boolean; port?: number } {
    return { running: Boolean(server), port: server?.port() };
  }

  async function stopServer(): Promise<{ wasRunning: boolean }> {
    const wasRunning = Boolean(server || starting);
    if (starting) {
      try {
        await starting;
      } catch {
        // The pending server never started; there is nothing to close.
      }
    }
    openedRefs.clear();
    if (!server) return { wasRunning };
    const closing = server;
    server = undefined;
    await closing.close();
    return { wasRunning };
  }

  return {
    async publish(input): Promise<PublishedPrototype> {
      const plan = toKebabCase(input.plan);
      const slug = toKebabCase(input.title);
      if (!plan || !slug) throw new Error("Prototype plan and title must not be empty");
      const ref = normalizeRef({ plan, slug });
      const manifest = await options.runPlanIO(
        publishPrototypeVersion({ ...input, plan: ref.plan, slug: ref.slug }),
      );
      const localServer = await ensureServer();
      localServer.notify(ref, manifest.latest_version);
      const key = openedKey(ref);
      const opened = !openedRefs.has(key);
      const url = localServer.url(ref);
      if (opened) {
        openedRefs.add(key);
        openExternal(url);
      }
      const summary = toSummary(manifest);
      return {
        ...summary,
        version: manifest.latest_version,
        versionFilePath: `${options.plansRoot}/${ref.plan}/prototypes/${ref.slug}/${manifest.versions.at(-1)?.file}`,
        url,
        opened,
      };
    },

    async list(plan?: string): Promise<PrototypeSummary[]> {
      const manifests = await options.runPlanIO(listPrototypes(plan));
      return manifests.map(toSummary);
    },

    async open(ref): Promise<{ url: string }> {
      const normalized = normalizeRef(ref);
      await options.runPlanIO(readPrototypeManifest(normalized.plan, normalized.slug));
      const localServer = await ensureServer();
      const url = localServer.url(normalized);
      openedRefs.add(openedKey(normalized));
      openExternal(url);
      return { url };
    },

    async startServer(): Promise<{ port: number }> {
      const localServer = await ensureServer();
      const port = localServer.port();
      if (!port) throw new Error("Prototype server did not receive a loopback port");
      return { port };
    },

    serverStatus,

    stopServer,

    async close(): Promise<void> {
      await stopServer();
    },
  };
}
