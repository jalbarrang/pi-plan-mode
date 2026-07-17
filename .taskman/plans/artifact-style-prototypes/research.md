# Research: artifact-style prototype previews

## Target behavior from Claude Code

- Claude Code artifacts are live, interactive web pages published from a terminal session to one private URL; the browser page updates in place as the session continues. This is the core behavior worth emulating locally. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts).
- Creation is conversational: Claude may choose an artifact when terminal text is the wrong medium, or the user can ask directly. Claude writes HTML or Markdown, asks permission before the first publish, prints the URL, opens the browser, and can reopen the most recent artifact with `Ctrl+]`. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts#create-an-artifact).
- Updates preserve identity: Claude edits the source and republishes to the same URL. Each publish becomes a version, and open viewers update in place. A URL is required to update the same artifact from a different Claude Code session. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts#update-an-artifact).
- Claude frames artifacts as captures of work, not deployed applications: one self-contained page, no backend, no multi-route application. Interactive controls are appropriate; persistent app state is not. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts#what-an-artifact-is-not).
- The page is constrained by a strict CSP: no external scripts, styles, fonts, images, `fetch`, XHR, or WebSockets; CSS and JavaScript are inline and images are data URIs. Published sources are `.html`, `.htm`, or `.md`, with a 16 MiB rendered limit. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts#page-constraints).
- Browser-to-terminal feedback is deliberately lightweight: Claude recommends an export control that produces text the user can paste back into the terminal. This avoids requiring a browser-to-agent command channel. Source: [Claude Code artifacts documentation](https://code.claude.com/docs/en/artifacts#bring-the-result-back-to-your-session).
- The broader Claude artifact model uses a dedicated workspace separate from the conversation so users can see, edit, and build on substantial content. Sources: [Anthropic announcement](https://www.anthropic.com/news/claude-3-5-sonnet) and [Projects announcement](https://www.anthropic.com/news/projects).

## Current pi-plan-mode behavior

- `extensions/plan-mode/tools/preview-prototype.ts` registers `preview_prototype({ title, intent, html })`, writes `<plans-root>/_prototypes/<title-slug>.html`, launches the OS default browser, and reports the file path.
- Reusing a title overwrites the only file; every call invokes `openInBrowser`, so iteration can create tab spam and has no version history.
- `intent` is accepted but is not persisted or displayed.
- `extensions/plan-mode/html/render.ts` preserves complete documents verbatim and wraps fragments in a minimal unstyled shell. The freeform design contract should remain intact inside the prototype frame.
- The package already has the needed pi seams: custom tools and commands, `session_shutdown`, and custom rendering. Pi docs explicitly require long-lived resources to start lazily after `session_start` and close idempotently on `session_shutdown`. Sources: local pi `docs/extensions.md` and `docs/tui.md`.
- The current clean CLI archives plan directories but not the shared `_prototypes/` directory. Plan-scoped storage would make prototype retention follow plan retention automatically.

## Architecture options and vote

| Option | Mechanism | Borda score |
|---|---|---:|
| C — Local live viewer | Immutable versions plus lazy loopback HTTP/SSE viewer | 12 |
| B — Static version viewer | Rewritten `file://` index with manual refresh | 7 |
| A — Raw overwrite | Current behavior with better messaging | 6 |
| D — Meta-refresh wrapper | Poll `latest.html` every ~2 seconds | 5 |

Three `anthropic/claude-fable-5` advisors voted independently through pragmatic, reliability, and maintainability lenses. All ranked C first. Their shared reason: only C satisfies one stable tab, live in-place revisions, and version navigation; `node:http` plus full-iframe SSE reload is bounded and testable. D destroys interaction/scroll state, B adds versioning without fixing iteration, and A preserves the current failure mode.

## Constraints discovered during challenge

- Pi fires `session_shutdown` not only on process exit but also on `/new`, `/resume`, `/fork`, `/clone`, and reload. A local server URL can therefore be guaranteed stable only for the current extension session unless a separate persistent process is introduced.
- Cross-session stable ports and multi-process server reuse add IPC/locking complexity and are not necessary for the first useful version. The local MVP should state the boundary honestly and provide `/prototypes` to reopen a persisted artifact in a new session.
- `Ctrl+]`, used by Claude Code to reopen its latest artifact, is already Pi’s default `tui.editor.jumpForward`; this extension should not shadow it. A command is safer than copying the shortcut.
- A localhost viewer gives agent-authored JavaScript a real origin. The prototype response should use a strict CSP and a sandboxed iframe without `allow-same-origin`, and the server must bind only to `127.0.0.1` and reject path traversal.
