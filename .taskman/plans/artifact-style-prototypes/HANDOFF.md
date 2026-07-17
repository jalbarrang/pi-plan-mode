# Add artifact-style live prototype previews

## Goal

Turn `preview_prototype` into a local Claude Code artifact-like review loop: the first publish opens one browser viewer, later publishes update that viewer in place, every revision remains navigable, and version-qualified feedback can be copied back into pi.

## Context

- Module root: `extensions/plan-mode/`.
- Base commit: `ab7eebf92fa4e2a6d6b2f233cb6a3658f2f9492a`.
- Research: `.taskman/plans/artifact-style-prototypes/research.md`.
- Deliberation: `.taskman/plans/artifact-style-prototypes/context.md`.
- Approved interaction prototype: `.taskman/plans/_prototypes/artifact-style-prototype-viewer.html`.
- The user approved the live viewer and a required `plan` parameter. Do not preserve plan-less writes as a compatibility fallback.

## What exists

- `extensions/plan-mode/tools/preview-prototype.ts` registers `preview_prototype({ title, intent, html })`, writes `<plans-root>/_prototypes/<slug>.html`, and invokes the OS opener on every call.
- Reusing a title destroys the prior file and can open another tab. `intent` is accepted but discarded.
- `extensions/plan-mode/html/render.ts` exports `buildPrototypeDocument(title: string, html: string): string`; it preserves complete HTML verbatim and wraps fragments in a minimal unstyled document. Keep this behavior.
- `extensions/plan-mode/index.ts` constructs one taskman `runPlanIO`, registers tools/commands, and receives `session_shutdown` events through pi’s extension interface.
- `extensions/plan-mode/ledger.ts` exports `PLANS_ROOT` and `plansPath(...segments: string[]): string`.
- Taskman’s `FileSystem` seam supports `readFileString`, `writeFileString`, `writeFileAtomic`, `makeDir`, `listDirectories`, and `removeFile`. `withFileLock(key, effect)` serializes same-process read-modify-write effects; do not nest the same lock key.
- Pi runs sibling tool calls concurrently after preflight. Prototype version allocation must therefore be protected by one per-prototype `withFileLock` section.
- Pi emits `session_shutdown` for quit, reload, new, resume, and fork. The local URL is guaranteed stable only for the current extension session; persisted prototypes reopen through `/prototypes` in the next session.
- Pi already binds `Ctrl+]` to editor jump-forward. Do not register Claude Code’s artifact shortcut.

## Approved behavior

1. The model calls `preview_prototype({ plan, title, intent, html })`; `plan` is the same normalized draft slug later passed to `submit_plan`.
2. The first call for a plan/title pair writes immutable `v001.html`, starts a lazy loopback server, opens one viewer tab, and returns both the local URL and on-disk path.
3. A later call with the same plan/title writes `v002.html`, atomically updates `manifest.json`, emits an SSE version event, and does not open another tab.
4. A viewer following latest swaps its sandboxed iframe to the new version. A viewer inspecting history stays on that snapshot and shows that a newer version exists.
5. Viewer chrome contains title, latest intent, connection/live state, version navigation, a live-update toggle, and feedback that copies `Prototype feedback [<slug> v<n>, plan <plan>]:\n<text>`.
6. `/prototypes [plan]` discovers persisted manifests, selects when needed, starts a fresh session server, and explicitly opens the chosen prototype. It works outside plan mode.
7. Prototype files archive or purge with their owning plan because storage lives under `<plans-root>/<plan>/prototypes/`.

## Deep module interface

Create the external seam in `extensions/plan-mode/prototypes/workspace.ts`. Tool and command adapters must not know about manifests, ports, tokens, SSE clients, routes, or open-once bookkeeping.

```ts
import type { RunPlanIO } from '@dreki-gg/taskman';

export interface PrototypeRef { plan: string; slug: string }
export interface PrototypeSummary extends PrototypeRef { title: string; latestVersion: number; latestIntent: string; updatedAt: string }
export interface PublishedPrototype extends PrototypeSummary { version: number; versionFilePath: string; url: string; opened: boolean }
export interface PrototypeWorkspace {
  publish(input: { plan: string; title: string; intent: string; html: string }): Promise<PublishedPrototype>;
  list(plan?: string): Promise<PrototypeSummary[]>;
  open(ref: PrototypeRef): Promise<{ url: string }>;
  close(): Promise<void>;
}
export type ExternalOpener = (url: string) => void;
export function createPrototypeWorkspace(options: { runPlanIO: RunPlanIO; plansRoot: string; openExternal?: ExternalOpener }): PrototypeWorkspace;
```

Interface invariants:

- `publish` normalizes `plan` and the title-derived prototype slug with taskman’s `toKebabCase`; empty results reject before writes.
- `publish` opens only the first time that normalized ref is published in the current workspace. `opened` reports whether it did.
- `open` always invokes the opener because it represents an explicit `/prototypes` request; it starts the server if needed and records the ref as opened for later publishes.
- `close` is idempotent and closes all SSE responses, timers, and the HTTP server.
- Inject `openExternal` for tests; the default retains the current best-effort cross-platform opener behavior.

Internal implementation may use `store.ts`, `server.ts`, and `viewer.ts`; keep them behind the workspace interface except for narrowly scoped internal tests.

## Persistent model

Store each prototype at `<plan>/prototypes/<slug>/` relative to the taskman runtime:

```text
<plan>/prototypes/<slug>/
├── manifest.json
├── v001.html
├── v002.html
└── ...
```

Manifest schema version 1:

```ts
interface PrototypeManifest {
  schema_version: 1;
  plan: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  latest_version: number;
  versions: Array<{ version: number; file: string; intent: string; created_at: string }>;
}
```

Allocate and write a version inside `withFileLock('prototype:<plan>/<slug>', ...)`: read and validate the manifest, calculate the next number, verify the target version file does not exist, write immutable HTML, then atomically replace the manifest. Corrupt manifests and unexpected target files fail loudly; never reset history or overwrite. Same-process concurrency is guaranteed; different OS processes publishing the same ref are outside scope and should fail on detectable conflicts rather than add IPC.

`list(plan?)` uses `FileSystem.listDirectories` and manifest reads. With a filter, inspect only the normalized plan. Without one, inspect ledger directories and their `prototypes` children; ignore `.archive`, `_prototypes`, and invalid/missing manifests. Broad discovery skips corrupt manifests; publishing or opening an exact corrupt ref fails.

## Local viewer and security

Use `node:http`, bind only `127.0.0.1` on port `0`, call `unref()`, and start lazily from `publish`/`open`. Generate a fixed-length random hex token in every route. Parse/decode path segments and validate plan/slug/version before storage calls; never join raw request paths to disk. Compare a well-formed token with `timingSafeEqual`.

Routes under `/t/<token>/p/<plan>/<slug>/`:

- `GET ./` returns the self-contained viewer shell.
- `GET ./manifest.json` returns validated metadata with `Cache-Control: no-store`.
- `GET ./v/<number>` returns exact stored HTML with `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
- `GET ./events` returns `text/event-stream`, heartbeats, and `event: version` payloads containing the latest version.

Viewer CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'none'`.

Prototype CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`.

The iframe uses `sandbox="allow-scripts allow-forms allow-modals allow-downloads"` and may use `allow="clipboard-write"`; never include `allow-same-origin`. The viewer uses relative URLs, renders metadata via `textContent`, reloads the full iframe, and shows disconnected state on `EventSource.onerror`. No route accepts POST data or invokes `pi.sendUserMessage`.

## Files to create

- `extensions/plan-mode/prototypes/store.ts` — manifest/version persistence.
- `extensions/plan-mode/prototypes/viewer.ts` — viewer shell.
- `extensions/plan-mode/prototypes/server.ts` — loopback HTTP/SSE implementation.
- `extensions/plan-mode/prototypes/workspace.ts` — deep module interface/orchestration.
- `extensions/plan-mode/commands/prototypes.ts` — `/prototypes` adapter.
- `extensions/plan-mode/__tests__/prototype-store.test.ts` — persistence/concurrency coverage.
- `extensions/plan-mode/__tests__/prototype-workspace.test.ts` — viewer/server/security coverage.
- `extensions/plan-mode/__tests__/preview-prototype.test.ts` — tool adapter coverage.
- `extensions/plan-mode/__tests__/prototypes-command.test.ts` — command adapter coverage.

## Files to modify

- `extensions/plan-mode/tools/preview-prototype.ts` — required `plan` and workspace adapter.
- `extensions/plan-mode/index.ts` — workspace, command, shutdown wiring.
- `extensions/plan-mode/prompts.ts` — draft plan slug instruction.
- `skills/visual-prototype/SKILL.md` — revised interaction contract.
- `README.md` — command/tool/storage/lifecycle docs.
- `extensions/plan-mode/__tests__/package-skills.test.ts` and/or `prompts.test.ts` — guidance assertions.

## Patterns to follow

- `extensions/plan-mode/tools/preview-prototype.ts` — tool registration, rendering, cross-platform opener.
- `extensions/plan-mode/html/render.ts` and `__tests__/html-render.test.ts` — authored document preservation.
- `extensions/plan-mode/__tests__/submit-plan.test.ts` — temp cwd/taskman runtime setup.
- `extensions/plan-mode/commands/list-plans.ts` — selection/notification conventions.
- `extensions/plan-mode/index.ts:242-340` — command registration.
- Local pi `docs/extensions.md` sections on long-lived resources, `session_shutdown`, and custom tools.
- Local pi `docs/tui.md` selection patterns; prefer `ctx.ui.select`.

## Non-goals

- No cloud publishing, sharing, public URLs, or organization permissions.
- No cross-session URL/port persistence, detached process, port file, IPC, or multi-process coordination.
- No browser-to-agent feedback endpoint, POST route, WebSockets, DOM patches, diff view, or side-by-side comparison.
- No Markdown artifacts, backend, multi-route app, external network access, or legacy `_prototypes/*.html` migration.
- No `Ctrl+]` or replacement shortcut.
- No clean CLI changes; plan-scoped storage follows plan archive/purge.

## Global STOP conditions

- Stop if implementation needs to bind beyond `127.0.0.1`, serve raw request paths, add an external runtime dependency, or weaken sandbox/CSP.
- Stop if preserving plan-less tool calls is proposed; the approved interface requires `plan`.
- Stop if version allocation cannot remain one `withFileLock` read-modify-write through taskman’s filesystem seam.
- Stop on unrelated pre-existing failures rather than rewriting unrelated behavior.