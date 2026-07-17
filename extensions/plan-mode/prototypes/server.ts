/** Loopback-only HTTP and SSE server for one workspace's prototype viewer URLs. */

import { createServer, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RunPlanIO } from "@dreki-gg/taskman";
import { isValidPrototypeSlug, readPrototypeManifest, readPrototypeVersion } from "./store.js";
import { buildViewerShell } from "./viewer.js";

const VIEWER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'none'";
const PROTOTYPE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const VERSION_PATTERN = /^\d{1,5}$/;
const TOKEN_BYTES = 32;

type SseClient = { response: ServerResponse; heartbeat: ReturnType<typeof setInterval> };

function decodeSegment(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function notFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function matchesToken(candidate: string | undefined, token: string): boolean {
  if (!candidate || candidate.length !== token.length) return false;
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const tokenBuffer = Buffer.from(token, "utf8");
  return (
    candidateBuffer.length === tokenBuffer.length && timingSafeEqual(candidateBuffer, tokenBuffer)
  );
}

export interface PrototypeServer {
  start(): Promise<void>;
  url(ref: { plan: string; slug: string }): string;
  notify(ref: { plan: string; slug: string }, latest: number): void;
  close(): Promise<void>;
}

export function createPrototypeServer(options: { runPlanIO: RunPlanIO }): PrototypeServer {
  let server: Server | undefined;
  let port: number | undefined;
  let token = "";
  const clients = new Map<string, Set<SseClient>>();

  function clientKey(plan: string, slug: string): string {
    return `${plan}/${slug}`;
  }

  function removeClient(key: string, client: SseClient): void {
    const scoped = clients.get(key);
    if (!scoped) return;
    clearInterval(client.heartbeat);
    scoped.delete(client);
    if (scoped.size === 0) clients.delete(key);
  }

  async function handle(request: import("node:http").IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return;
    }

    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      notFound(response);
      return;
    }
    const parts = path.split("/");
    const routeToken = decodeSegment(parts[2]);
    const plan = decodeSegment(parts[4]);
    const slug = decodeSegment(parts[5]);
    const action = decodeSegment(parts[6]);
    const extra = parts.length > 7 ? parts.slice(7) : [];

    if (
      parts[0] !== "" ||
      parts[1] !== "t" ||
      parts[3] !== "p" ||
      !matchesToken(routeToken, token) ||
      !plan ||
      !slug ||
      !isValidPrototypeSlug(plan) ||
      !isValidPrototypeSlug(slug)
    ) {
      notFound(response);
      return;
    }

    if (action === undefined || action === "") {
      if (extra.length > 0 || action === undefined) {
        notFound(response);
        return;
      }
      try {
        const manifest = await options.runPlanIO(readPrototypeManifest(plan, slug));
        const intent = manifest.versions.at(-1)?.intent ?? "";
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": VIEWER_CSP,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(buildViewerShell({ title: manifest.title, intent, plan, slug }));
      } catch {
        notFound(response);
      }
      return;
    }

    if (action === "manifest.json" && extra.length === 0) {
      try {
        const manifest = await options.runPlanIO(readPrototypeManifest(plan, slug));
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify(manifest));
      } catch {
        notFound(response);
      }
      return;
    }

    if (action === "events" && extra.length === 0) {
      try {
        await options.runPlanIO(readPrototypeManifest(plan, slug));
      } catch {
        notFound(response);
        return;
      }
      const key = clientKey(plan, slug);
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write("retry: 1000\n\n");
      const client: SseClient = {
        response,
        heartbeat: setInterval(() => response.write(": heartbeat\n\n"), 25_000),
      };
      client.heartbeat.unref();
      const scoped = clients.get(key) ?? new Set<SseClient>();
      scoped.add(client);
      clients.set(key, scoped);
      request.once("close", () => removeClient(key, client));
      return;
    }

    if (action === "v" && extra.length === 1) {
      const versionText = decodeSegment(extra[0]);
      if (!versionText || !VERSION_PATTERN.test(versionText)) {
        notFound(response);
        return;
      }
      try {
        const html = await options.runPlanIO(readPrototypeVersion(plan, slug, Number(versionText)));
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": PROTOTYPE_CSP,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(html);
      } catch {
        notFound(response);
      }
      return;
    }

    notFound(response);
  }

  return {
    async start(): Promise<void> {
      if (server) return;
      token = randomBytes(TOKEN_BYTES).toString("hex");
      const nextServer = createServer((request, response) => {
        void handle(request, response);
      });
      await new Promise<void>((resolve, reject) => {
        nextServer.once("error", reject);
        nextServer.listen(0, "127.0.0.1", () => {
          nextServer.off("error", reject);
          resolve();
        });
      });
      const address = nextServer.address();
      if (!address || typeof address === "string") {
        await new Promise<void>((resolve) => nextServer.close(() => resolve()));
        throw new Error("Prototype server did not receive a loopback port");
      }
      server = nextServer;
      port = address.port;
      server.unref();
    },

    url(ref): string {
      if (!port) throw new Error("Prototype server is not running");
      return `http://127.0.0.1:${port}/t/${token}/p/${ref.plan}/${ref.slug}/`;
    },

    notify(ref, latest): void {
      const payload = `event: version\ndata: ${JSON.stringify({ latest })}\n\n`;
      for (const client of clients.get(clientKey(ref.plan, ref.slug)) ?? [])
        client.response.write(payload);
    },

    async close(): Promise<void> {
      for (const scoped of clients.values()) {
        for (const client of scoped) {
          clearInterval(client.heartbeat);
          client.response.end();
        }
      }
      clients.clear();
      const closing = server;
      server = undefined;
      port = undefined;
      token = "";
      if (!closing) return;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    },
  };
}
