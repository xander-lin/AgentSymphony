import type { HubConversation, HubMessage } from "./types.ts"

export function formatInjectedHubPrompt(message: HubMessage, conversation: HubConversation, createdByThisInstance: boolean): string {
  return [
    `You received a delegated AgentSymphony message in thread '${conversation.threadName}'.`,
    createdByThisInstance ? "This thread was created by this OpenCode instance." : "This thread was created by another OpenCode instance.",
    "",
    "Reply normally to this request. If you need to respond back through AgentSymphony, call `agentsymphony_hub_reply` with your message. Routing is handled automatically.",
    "If you are handling multiple AgentSymphony threads, pass the visible thread name to `agentsymphony_hub_reply`.",
    "",
    "Message:",
    message.content,
  ].join("\n")
}
