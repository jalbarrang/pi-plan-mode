# Artifact-style prototype previews

## Intent

- Replace the current overwrite-and-open prototype loop with a Claude Code artifact-like review loop: one browser tab, in-place agent revisions, visible versions, and easy feedback back to the terminal.
- Preserve the existing principle that the agent or UX designer owns the prototype’s visual design; viewer chrome must remain outside the sandboxed prototype.
- Keep this a planning convergence aid, not a deployment or sharing product.

## Decisions

- **Provisional architecture: local live viewer.** Use a lazy `127.0.0.1` HTTP server and SSE notification; each revision performs a full iframe reload rather than DOM patching.
- **Immutable versions.** Persist `v001.html`, `v002.html`, and metadata containing title, intent, timestamps, and latest version. Never destroy the prior review state.
- **Plan-scoped ownership.** Extend the tool input with a draft plan slug and store prototypes under `<plans-root>/<plan>/prototypes/<prototype>/` so clean/archive follows the plan and same-titled prototypes in different plans cannot collide.
- **Stable only within the current extension session.** Pi tears down extension resources on session replacement. `/prototypes` will discover persisted manifests and reopen them under the new session’s URL; no detached service or cross-session port protocol in MVP.
- **Open once, then update in place.** First publish opens the viewer. Later calls for the same plan/prototype write a new version, emit SSE, and notify without opening another tab.
- **Feedback by clipboard.** Viewer feedback UI copies a version-qualified prompt for pasting into pi. No browser-to-agent POST endpoint.
- **Security boundary.** Loopback-only bind, opaque session token in viewer paths, traversal-safe route parsing, sandboxed iframe without same-origin, strict no-network CSP on prototype responses.
- **No Claude shortcut clone.** Pi already owns `Ctrl+]`; expose `/prototypes [plan]` instead.

## Constraints

- Existing public tool signature is `preview_prototype({ title, intent, html })`; adding a plan scope should be backwards-compatible if possible, but silent global storage would preserve the orphan/collision problem.
- Storage currently goes through taskman’s `RunPlanIO` and `FileSystem`; keep writes on that seam and use atomic writes for manifest/viewer metadata.
- The tool is active only in plan mode. `/prototypes` should work whenever persisted prototypes exist.
- Full prototype documents must remain visually untouched; all artifact chrome belongs to a separate viewer shell.
- Browser auto-open remains best-effort in headless/print contexts.

## Resolved questions

- User approved the live viewer shown in `.taskman/plans/_prototypes/artifact-style-prototype-viewer.html`: stable tab within a planning session, live in-place updates, version navigation, and clipboard feedback.
- User approved making `plan` required in `preview_prototype({ plan, title, intent, html })`; there is no plan-less compatibility path.
- Keep all immutable versions initially. Plan-scoped archive/purge owns retention; no special pruning policy in this change.

## Discarded options

- **Raw overwrite:** rejected because it preserves tab spam, destructive revision loss, and manual refresh.
- **Static `file://` viewer:** rejected as primary because it cannot discover updates without rewriting/reloading; it does not deliver the live review loop. A generated static index may still be useful as a persistence fallback.
- **Meta-refresh wrapper:** rejected because periodic reload destroys hover/form/scroll state and creates browser-dependent flicker.
- **Detached persistent server or cloud sharing:** rejected for MVP because IPC, locking, auth, retention, and public exposure are separate products.
- **Direct browser-to-agent feedback endpoint:** rejected because clipboard export matches Claude’s documented feedback pattern without introducing a prompt-injection channel.

## Blast radius

- No deletion or rename is planned. Existing `preview_prototype` behavior will be replaced compatibly at the tool boundary where practical; versioned persistence changes the on-disk layout for future calls only.
