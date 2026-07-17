/** preview_prototype tool — available during the plan phase. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildPrototypeDocument } from "../html/render.js";
import type { PrototypeWorkspace } from "../prototypes/workspace.js";

export function registerPreviewPrototypeTool(
  pi: ExtensionAPI,
  workspace: PrototypeWorkspace,
): void {
  pi.registerTool({
    name: "preview_prototype",
    label: "Preview Prototype",
    description:
      "Publish a freeform HTML prototype for review during planning. The required plan must match the draft name later passed to submit_plan.",
    promptSnippet: "Publish a plan-owned freeform HTML prototype for the user to review",
    promptGuidelines: [
      "Use preview_prototype during planning for visual/UI/layout/style work, before submit_plan.",
      "Pass plan as the same kebab-case draft name that you will pass to submit_plan.",
      "The prototype is a convergence aid — gather user feedback before the plan hardens.",
      "Each publish creates an immutable version and updates the live viewer in place; do not call this tool just to reopen it — use /prototypes.",
      "You have full freedom over the HTML: there is no template engine and no imposed theme. Pass a complete, self-contained HTML document (doctype + html/head/body), or a bare fragment that will be wrapped in a minimal unstyled shell.",
    ],
    parameters: Type.Object({
      plan: Type.String({
        description:
          "Kebab-case draft plan name that owns this prototype (the same name you will pass to submit_plan)",
      }),
      title: Type.String({ description: "Short title for the prototype" }),
      intent: Type.String({
        description: "One-line description of what this prototype is showing",
      }),
      html: Type.String({
        description:
          "Complete, self-contained HTML document for the prototype (your own markup, styles, and scripts). A bare fragment is also accepted and wrapped in a minimal unstyled shell.",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const prototype = await workspace.publish({
        plan: params.plan,
        title: params.title,
        intent: params.intent,
        html: buildPrototypeDocument(params.title, params.html),
      });
      const text = prototype.opened
        ? `Prototype "${params.title}" published at ${prototype.url}; the live viewer opened there. Version saved to ${prototype.versionFilePath}. Ask the user for feedback before submitting the plan.`
        : `Prototype "${params.title}" updated in place to v${prototype.version} at ${prototype.url}; no new tab opened. Version saved to ${prototype.versionFilePath}. Ask the user for feedback before submitting the plan.`;
      ctx?.ui?.notify(
        prototype.opened
          ? `Prototype viewer opened at ${prototype.url}`
          : `Prototype updated in place to v${prototype.version} at ${prototype.url}`,
        "info",
      );

      return {
        content: [{ type: "text" as const, text }],
        details: {
          url: prototype.url,
          plan: prototype.plan,
          slug: prototype.slug,
          version: prototype.version,
          filePath: prototype.versionFilePath,
          opened: prototype.opened,
        },
      };
    },

    renderCall(args, theme) {
      const title = (args as { title?: string }).title ?? "prototype";
      const plan = (args as { plan?: string }).plan;
      let content = theme.fg("toolTitle", theme.bold("preview_prototype "));
      content += theme.fg("accent", title);
      if (plan) content += " " + theme.fg("dim", plan);
      return new Text(content, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as
        | { version?: number; url?: string; filePath?: string }
        | undefined;
      const destination = details?.url ?? details?.filePath;
      const label = destination
        ? `✓ Prototype v${details?.version ?? "?"} → ${destination}`
        : "✓ Prototype rendered";
      return new Text(theme.fg("success", label), 0, 0);
    },
  });
}
