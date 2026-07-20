# @dreki-gg/pi-plan-mode

Two-phase planning workflow for [pi](https://github.com/badlogic/pi-mono).

Plan with `claude-opus-4-6:medium`, execute with `gpt-5.5:low`. Plans are persisted as files in the plan ledger (default `.taskman/plans/`) for clean context handoff between models.

## Install

```bash
pi install npm:@dreki-gg/pi-plan-mode
```

## Where plans live (`.taskmanrc`)

The plans root is resolved the same way the [taskman](https://github.com/jalbarrang/taskman) CLI resolves it: the default is `.taskman/plans/`, overridable per-project by a `.taskmanrc` JSON file in the working directory whose `plans-root` value IS the ledger folder (it contains `plans.jsonl` directly):

```json
{ "plans-root": ".plans" }
```

Resolution is cwd-only by design — no walk-up, no env var — so the extension, the `taskman` CLI, and the `clean` command always agree on which folder holds the ledger. A malformed `.taskmanrc` fails loudly at load instead of silently writing plans to the wrong place. External-target writes (`submit_plan` / `revise_plan` / `add_task` with `target`) honour the **target repo's** own `.taskmanrc`.

Throughout this README, `.taskman/plans/` refers to the resolved plans root.

Recommended companions:

```bash
pi install npm:@dreki-gg/pi-questionnaire
pi install npm:@dreki-gg/pi-subagent
```

## What it provides

| Feature  | Name           | Notes                                          |
| -------- | -------------- | ---------------------------------------------- |
| Flag     | `--plan`       | Start pi in plan mode                          |
| Command  | `/plan [prompt]` | Enter plan mode, optionally with a starting prompt |
| Command  | `/plan resume` | Pick up an in-progress plan from disk          |
| Command  | `/plan focus <name>` | Pin a plan so tracking calls default to it (multi-plan repos) |
| Command  | `/plans`       | List/filter/sort plans                          |
| Command  | `/initiatives` | List initiatives with member-plan rollup        |
| Command  | `/todos`       | Show current plan progress                     |
| Command  | `/prototypes [plan]` | Reopen a stored prototype in the live viewer |
| Command  | `/workflow [task]` | Design and approve a bounded background subagent workflow |
| Command  | `/workflow save [project\|user] [name]` | Save the latest approved or cancelled draft as a reusable chain |
| Command  | `/workflow run [project\|user] <name>` | Launch a saved workflow |
| Command  | `/workflow status\|stop\|resume` | Inspect or control the session's current workflow run |
| Shortcut | `Ctrl+Alt+P`   | Toggle plan mode                               |
| Tool     | `preview_prototype` | Publish a plan-owned HTML prototype to a live local viewer (immutable versions) |
| Tool     | `revise_plan`  | Rewrite an existing plan in place (title/handoff/tasks) |
| Tool     | `update_task`  | Mark a task done / skipped / blocked           |
| Tool     | `update_tasks` | Mark several tasks done / skipped in one call  |
| Tool     | `add_task`     | Capture a discovered follow-up (deferred)      |
| Tool     | `plan_status`  | Read-only snapshot; progress table when many plans are active |
| Tool     | `set_active_plan` | Pin a plan as active (tool form of `/plan focus`) so tracking calls target it |
| Tool     | `update_plan`  | Close/reopen a plan: done, superseded, abandoned, in-progress |
| Tool     | `submit_initiative` | Create an initiative that groups multiple plans          |
| Tool     | `update_initiative` | Close/reopen an initiative: done, superseded, abandoned, in-progress |
| Tool     | `initiative_status` | Snapshot an initiative: member plans, progress, ready/blocked |
| Tool     | `reconcile_plans` | Detect & repair drift between tasks.jsonl and the registry (plans **and** initiatives) |
| Tool     | `submit_workflow` | Validate, inspect/edit, approve, and launch a bounded workflow |

## Dynamic Workflow Mode

`/workflow <task>` is a read-only design mode for large, parallelizable work. It mirrors the core loop of Claude Code dynamic workflows while using `@dreki-gg/pi-subagent` as the runner:

1. The agent investigates and proposes a declarative workflow.
2. The agent writes the workflow JSON to `.taskman/workflows/<name>.json`, then calls `submit_workflow` with `file: "<name>"`. The inline `workflow` object is no longer accepted.
3. `submit_workflow` loads and validates that draft, shows the exact JSON, and requires your explicit approval.
4. The approved version launches in the background with **ambient progress**: a live widget below the editor shows a spinner, phase checklist, and elapsed time (plus agent counts when the pi-subagent bridge reports them), while a footer indicator (`⚙ wf 3/9 <phase>`) polls the run every few seconds. The terminal state (completed / failed / stopped) is announced into the conversation with the phase list and a final-output snippet — no manual polling needed. `/workflow status`, `/workflow stop`, and `/workflow resume` still control and inspect the run on demand.
5. Workflow drafts in `.taskman/workflows/` are temporary and gitignored. `/workflow save` still stores a reviewed workflow in `.pi/chains/<name>.chain.json` (project) or `~/.pi/agent/chains/<name>.chain.json` (user); `/workflow run` still replays it.

The workflow format is intentionally bounded: sequential agent steps, static parallel groups, and dynamic fan-out from an earlier named JSON output. Every fan-out must declare `maxItems`; the validator rejects workflows whose static worst case exceeds 100 agents. Product writes remain blocked until the approved background run starts.

Install the companion runner before using it:

```bash
pi install npm:@dreki-gg/pi-subagent
```

This is not an arbitrary-JavaScript runtime. It does not include Claude Code's `ultracode` keyword, automatic routing, arbitrary loop/branch scripts, workflow-size configuration, or large-run warning UI.

## Prototypes — artifact-style visual review

For visual/UI work, the planner publishes an HTML prototype with `preview_prototype({ plan, title, intent, html })`. `plan` is required and must match the draft name later passed to `submit_plan` — prototypes live with their owning plan and archive with it.

The review loop mirrors Claude Code artifacts, kept entirely local:

- The **first publish** opens a live viewer in your browser at a `127.0.0.1` URL (loopback-only, token-guarded, sandboxed iframe with a strict CSP).
- **Every later publish** for the same plan/title writes a new immutable version (`v001.html`, `v002.html`, …) and the open viewer updates **in place** over SSE — same tab, no reopen.
- The viewer offers **version navigation** (earlier revisions stay browsable), a live-updates toggle, and a **feedback box** that copies a version-qualified note (`Prototype feedback [<slug> v3, plan <plan>]: …`) for pasting back into the pi session.

Storage layout (inside the plans root):

```text
<plans-root>/<plan>/prototypes/<slug>/
├── manifest.json   # title, per-version intents, latest version
├── v001.html       # immutable — never overwritten
└── v002.html
```

The viewer URL is **local and session-scoped**: it dies with the pi session (`/new`, `/resume`, `/fork`, quit). The versions on disk persist — run `/prototypes [plan]` in any later session to reopen them under a fresh URL. There is no cloud publishing or sharing; nothing leaves your machine.

## Initiatives — grouping large work

When a body of work is too large for a single plan, group it under an **initiative**.
An initiative is one level above a plan; the same projection rule applies one level up:

```
Initiative  status = projection of its member plans' statuses
   Plan     status = projection of its tasks' statuses
      Task  base state
```

An initiative is `done` when it has ≥1 member plan and every member is terminal
(`done` / `superseded` / `abandoned`). Member plans link to the initiative by name and
carry **plan-level** `depends_on` (cross-initiative allowed), so the extension can compute
*ready work* — plans whose dependencies are all `done`. `initiative_status` surfaces, per
member plan, whether it is **ready** or **blocked by** which plans — the view you want when
splitting an initiative across sessions or subagents.

```text
# 1. Create the initiative
submit_initiative(name: "auth-overhaul", title: "Auth Overhaul", overview: "...")

# 2. Submit member plans linked + ordered
submit_plan(name: "auth-schema",  initiative: "auth-overhaul")
submit_plan(name: "auth-jwt",     initiative: "auth-overhaul", depends_on_plans: ["auth-schema"])
submit_plan(name: "auth-ui",      initiative: "auth-overhaul", depends_on_plans: ["auth-jwt"])

# 3. See what's ready to pick up
initiative_status(initiative: "auth-overhaul")
```

Initiative lifecycle mirrors plans: `done` is projected automatically, while `superseded` /
`abandoned` (and reopen) are explicit via `update_initiative` with a `reason`. The `clean`
CLI archives closed initiatives the same way it archives closed plans.

### Plan lifecycle status

The registry (`.taskman/plans/plans.jsonl`) `status` is a **projection of task state**, not a
hand-maintained flag. Marking every task `done`/`skipped` (via `update_task`, in any
session or model) automatically flips the plan to `done` — completion is no longer
coupled to a formal in-session execution run.

| Status        | Meaning                                            | Active? |
| ------------- | -------------------------------------------------- | ------- |
| `in-progress` | Active, tracked, eligible for auto-resolution      | ✅      |
| `done`        | All tasks resolved                                 | —       |
| `superseded`  | Another plan absorbed the work                     | —       |
| `abandoned`   | Won't do / rejected                                | —       |

`superseded` / `abandoned` are set explicitly via `update_plan` (with a `reason`) and are
never auto-overridden by task reconciliation. Only `in-progress` plans participate in
active-plan resolution.

In repos with **many** in-progress plans, an explicit `{ plan: "<name>" }` on
`update_task` / `add_task` / `plan_status` **always** targets that plan — it is never
silently overridden by whatever plan was last submitted in the session.

## Workflow

### 1. Plan (`claude-opus-4-6:medium`)

```text
/plan add authentication middleware with JWT support
```

The planner has access to read-only tools plus `edit`/`write` restricted to files inside the plans root. Bash is locked to a strict allowlist of safe commands.

The planner:
- Inspects the codebase using read-only tools
- Uses `questionnaire` when requirements are underspecified
- Creates `.taskman/plans/<kebab-name>/PLAN.md` with the full numbered plan
- Creates `.taskman/plans/<kebab-name>/START-PROMPT.md` — a self-contained handoff prompt with all context needed to execute without the planning conversation
- Can add supporting files in the same directory for extra context

### 2. Choose next step

When the planner finishes, a menu appears:

| Option           | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| **Execute Plan** | Extract todos from PLAN.md, switch to gpt-5.5:low, start with START-PROMPT.md |
| **Refine Plan**  | Adversarial review — planner critiques its own plan and updates files  |
| **Follow up**    | Open an editor for additional instructions to the planner              |
| **Exit plan mode** | Disable plan mode and restore original model                        |

### 3. Execute (`gpt-5.5:low`)

When **Execute Plan** is selected:
1. Todos are extracted from `PLAN.md`
2. Model switches to `gpt-5.5:low` with full tool access
3. The executor starts with a **clean context window** using `START-PROMPT.md`
4. Each step must be marked with `[DONE:n]` before moving to the next
5. Progress is tracked in a widget in the status bar
6. When all steps complete, the original model and thinking level are restored

## Plan directory structure

```
.taskman/plans/               # or your .taskmanrc plans-root
├── plans.jsonl               # Plan registry — plan status lifecycle
├── initiatives.jsonl         # Initiative registry — groups member plans
├── auth-overhaul/            # An initiative directory
│   └── INITIATIVE.md         # Initiative overview + plan breakdown
└── auth-jwt/                 # A member plan (linked by name in the registry)
    ├── HANDOFF.md            # Self-contained executor handoff
    ├── tasks.jsonl           # Tasks (gains optional initiative + plan-level depends_on)
    └── ...                   # Optional supporting files
```

### plans.json

The extension automatically maintains the ledger's `plans.json` to track plan lifecycle:

```json
{
  "add-auth-middleware": {
    "status": "in-progress",
    "title": "Add Authentication Middleware with JWT Support",
    "created": "2026-05-08T12:00:00.000Z",
    "completed": null
  },
  "fix-ci-flakes": {
    "status": "done",
    "title": "Fix CI Flaky Tests",
    "created": "2026-05-07T10:00:00.000Z",
    "completed": "2026-05-07T14:30:00.000Z"
  }
}
```

Plans start as `"in-progress"` when created and are marked `"done"` when all execution steps complete. This prevents accidental deletion of in-flight plans.

## Cleaning completed plans

Use the CLI to clean closed plans (`done` / `superseded` / `abandoned`). By default it
**archives** plan directories to `.taskman/plans/.archive/<name>/` — keeping HANDOFF.md and
tasks.jsonl as a record — rather than deleting them:

```bash
# Preview what would be cleaned (no changes)
npx @dreki-gg/pi-plan-mode clean --dry-run

# Archive closed plans to <plans-root>/.archive/ and update plans.jsonl
npx @dreki-gg/pi-plan-mode clean

# Permanently delete instead of archiving
npx @dreki-gg/pi-plan-mode clean --purge
```

In-flight plans (`"status": "in-progress"`) are never touched. Archiving is the default so
that closing out a finished plan never silently destroys its handoff + task ledger.

### GitHub Actions

Clean done plans automatically after merge — similar to changesets:

```yaml
name: Clean Plans

on:
  push:
    branches: [main]
    paths: ['.taskman/plans/**'] # match your .taskmanrc plans-root

jobs:
  clean:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npx @dreki-gg/pi-plan-mode clean
      - name: Commit cleanup
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .taskman/plans/
          git diff --cached --quiet || git commit -m "chore: clean completed plans"
          git push
```

### Should you gitignore the plans root?

**No.** Commit your plans — they provide decision history and execution context. Use the `clean` CLI to remove done plans after merge, keeping the directory lean. Plans are execution blueprints, not permanent documentation; for lasting decisions, use ADRs.

## Footer indicators

- `📝 plan` — plan mode active (opus-4-6:medium, strict bash)
- `📋 exec 2/5` — executing plan with gpt-5.5:low, 2 of 5 steps done
- `⚙ wf 3/9 <phase>` — background workflow running, updates every few seconds; flips to `✓ wf completed 9/9` / `✗ wf failed` / `◼ wf stopped` at the end

## Bash safety

In plan mode, bash is restricted to read-only commands (ls, grep, git status, cat, rg, etc.). Destructive commands (rm, mv, git commit, etc.) are blocked.

## CLI reference

```
pi-plan-mode clean [--dry-run] [--purge]
```

| Option      | Description                                                        |
| ----------- | ----------------------------------------------------------------- |
| `clean`     | Archive closed plan directories to `<plans-root>/.archive/`, update manifest |
| `--dry-run` | Show what would be cleaned without changing anything              |
| `--purge`   | Permanently delete instead of archiving                           |
