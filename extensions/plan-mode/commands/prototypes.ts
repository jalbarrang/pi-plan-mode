import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { toKebabCase } from "@dreki-gg/taskman";
import type { PrototypeWorkspace } from "../prototypes/workspace.js";

export async function handlePrototypes(
  ctx: ExtensionCommandContext,
  workspace: PrototypeWorkspace,
  args: string | undefined,
): Promise<void> {
  const requestedPlan = args?.trim();
  const planFilter = requestedPlan ? toKebabCase(requestedPlan) : undefined;

  if (requestedPlan && !planFilter) {
    ctx.ui.notify(
      `No prototypes found for "${requestedPlan}" — build one with preview_prototype during planning.`,
      "info",
    );
    return;
  }

  let prototypes;
  try {
    prototypes = await workspace.list(planFilter);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not list prototypes: ${message}`, "error");
    return;
  }

  if (prototypes.length === 0) {
    const filter = planFilter ? ` for "${planFilter}"` : "";
    ctx.ui.notify(
      `No prototypes${filter} yet — build one with preview_prototype during planning.`,
      "info",
    );
    return;
  }

  let selected = prototypes[0];
  if (prototypes.length > 1) {
    const labels = prototypes.map(
      (prototype) =>
        `${prototype.title} — ${prototype.plan} (v${prototype.latestVersion}, ${prototype.updatedAt})`,
    );
    const choice = await ctx.ui.select("Open a prototype:", labels);
    if (!choice) return;
    selected = prototypes[labels.indexOf(choice)];
  }

  const { url } = await workspace.open(selected);
  ctx.ui.notify(`Prototype viewer opened at ${url}`, "info");
}
