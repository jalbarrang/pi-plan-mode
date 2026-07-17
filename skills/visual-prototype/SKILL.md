---
name: visual-prototype
description: Build a visual HTML prototype during planning for UI, component, layout, or style changes, so the user can react to the design before the plan is finalized. Use when a plan touches frontend appearance or interaction. Not for backend-only or non-visual work.
---

# Visual Prototype

A prototype is a **convergence artifact**, not a deliverable. When a plan changes how something looks or behaves visually, a static markdown plan cannot show the user what they are agreeing to. Build the prototype while the plan is still soft, show it, and let the user redirect you before anything is committed to `submit_plan`.

## When to use

Use this when the plan involves any of:

- New or restyled UI components
- Layout, spacing, or visual hierarchy changes
- Color, typography, or theming changes
- Interaction states (hover, active, empty, loading, error)

Do **not** use it for backend-only, refactor-only, or otherwise non-visual work.

## Process

### 1. Decide there is something to see

If you cannot picture a screen or component changing, skip the prototype. A prototype for invisible work is noise.

### 2. Publish it with `preview_prototype`

Call `preview_prototype` with:

- `plan` — **required.** The kebab-case draft plan name that owns this prototype — the same name you will later pass to `submit_plan`. Versions are stored under `<plans-root>/<plan>/prototypes/<slug>/` and archive with the plan.
- `title` — short name for the prototype (its slug is derived from this)
- `intent` — one line describing what this version shows
- `html` — a complete, self-contained HTML document you author **with full freedom**. There is no template engine and no imposed theme: pick your own markup, fonts, colors, layout, and inline `<style>`/`<script>`. Assume nothing about a host page. (A bare fragment is tolerated and dropped into a minimal unstyled shell, but prefer sending a full document.)

The first publish opens a live viewer in the browser at a local URL. Every later publish for the same plan and title creates a new **immutable version** (v001, v002, …) and the open viewer updates **in place** — same tab, no reopen. The viewer shows the version history, so earlier revisions stay navigable while you iterate.

**Avoid generic boilerplate.** A dark dashboard with a purple accent and a card is not a design — it is slop. Design something that fits the actual product. For real design taste, delegate the markup to the `ux-designer` subagent and pass its HTML straight through `preview_prototype`.

### 3. Get a reaction before submitting

Stop and ask the user what they think. The viewer has a feedback box that copies a version-qualified note (`Prototype feedback [<slug> v<n>, plan <plan>]: …`) for pasting straight back into the pi session. Iterate — publish revisions until the visual direction is agreed. Only then move toward `submit_plan`.

`submit_plan` never generates HTML. The prototype lives entirely in the planning phase; its job is done once the user has reacted.

## Reopening and lifecycle

The viewer URL is local and lives only as long as the current pi session — starting a new session, resuming, or forking replaces it. The versions on disk persist: run `/prototypes [plan]` at any time to reopen a stored prototype under a fresh URL. Do not re-call `preview_prototype` just to reopen a viewer.

## Relationship to context.md

The prototype is the visual sibling of `context.md`. Both are deliberation artifacts that exist to slow the jump from "read the codebase" to "submit the plan." Keep `context.md` current as the living written record of intent, decisions, and open questions; use a prototype whenever the decision is visual. Resist the urge to skip straight to `submit_plan` on visual work.
