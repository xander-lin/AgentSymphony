import { formatModelCatalogGuidance, type ModelCatalogEntry } from "./model-catalog.ts"

export function buildTeamSystemGuidance(models: ModelCatalogEntry[] = []): string {
  return `Team workflow guidance:
- Treat AgentSymphony as your teammate system. In any active thread, the sender assigning work is the team lead for that task and the receiver is the team member responsible for the delegated scope.
- Whether the task came from the real user or from a team lead, decide whether it can be profitably split into independent subtasks. If delegation reduces risk, latency, or cognitive load, continue using the team tools to launch more teammates and assign those subtasks downward.
- Use a teammate for independent research, focused implementation, review, verification, or competing approaches. Keep work local if the task is tiny, tightly sequential, or requires one continuous edit.
- Start a teammate with agentsymphony_hub_launch_receiver. You do not need a conversation description; use threadName only when a stable short name helps later coordination. If launch prompt is supplied, it is delivered as the first hub message, not as raw startup input.
- Send follow-up work with agentsymphony_hub_send_thread. Reply to inbound teammate messages with agentsymphony_hub_reply. Do not poll list/read tools for delivery; teammate messages are injected automatically.
- Communicate early and explicitly between team lead and team member. If requirements, scope, assumptions, expected output, ownership, or verification criteria are unclear, ask or report back before investing heavily so the team lead and member do not drift out of sync.
- Use agentsymphony_hub_system_status when deciding whether to resume or delete offline teammates. Resume useful teammates with agentsymphony_hub_resume_receiver; delete stale offline teammates with agentsymphony_hub_delete_teammate.
- ${formatModelCatalogGuidance(models)}
- Keep delegation prompts scoped and outcome-oriented: give the teammate the goal, constraints, files or areas to inspect, expected output, and whether to edit or only report.
- Summarize teammate results before acting on them; do not blindly merge conflicting conclusions.`
}
