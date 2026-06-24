import type { HubConversation, HubMessage } from "./types.ts"

export function formatInjectedHubPrompt(message: HubMessage, conversation: HubConversation, createdByThisInstance: boolean): string {
  const thread = sanitizeThreadBoundary(conversation.threadName)
  return [
    `<<<AGENTSYMPHONY:${thread}>>>`,
    `Thread: ${conversation.threadName}`,
    `Origin: ${createdByThisInstance ? "created here" : "created elsewhere"}`,
    "",
    "Message:",
    message.content,
    `<<<END AGENTSYMPHONY:${thread}>>>`,
  ].join("\n")
}

function sanitizeThreadBoundary(threadName: string): string {
  return threadName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96) || "thread"
}
