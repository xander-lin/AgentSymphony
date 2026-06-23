import { describe, expect, it } from "vitest"
import { MemoryMessageBus } from "../src/messages/memory.ts"
import { MockOpenCodeRunner } from "../src/runtime/mock.ts"
import { AgentSymphonyService } from "../src/symphony/service.ts"
import { MockTerminalLauncher } from "../src/terminal/mock.ts"

describe("AgentSymphonyService", () => {
  it("creates a conversation and records initial child response", async () => {
    const service = new AgentSymphonyService(new MemoryMessageBus(), new MockOpenCodeRunner(), new MockTerminalLauncher())

    const conversation = await service.createConversation({
      title: "implement search",
      initialMessage: "Please plan search implementation.",
    })

    expect(conversation?.status).toBe("active")
    expect(conversation?.sessionId).toMatch(/^session_/)
  })

  it("sends follow-up messages to the existing session", async () => {
    const service = new AgentSymphonyService(new MemoryMessageBus(), new MockOpenCodeRunner(), new MockTerminalLauncher())
    const conversation = await service.createConversation({ title: "reviewer" })

    await service.sendMessage({ conversationId: conversation.id, message: "Review the API." })
    const messages = await service.readMessages(conversation.id)

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe("parent")
    expect(messages[1]?.role).toBe("child")
    expect(messages[1]?.content).toContain("Review the API.")
  })

  it("opens a TUI terminal for an active conversation", async () => {
    const terminal = new MockTerminalLauncher()
    const service = new AgentSymphonyService(new MemoryMessageBus(), new MockOpenCodeRunner(), terminal)
    const conversation = await service.createConversation({ title: "builder", initialMessage: "Start work.", openTui: true })

    expect(terminal.launches).toHaveLength(1)
    expect(terminal.launches[0]?.sessionId).toBe(conversation.sessionId)
    expect(terminal.launches[0]?.title).toBe("builder")
  })

  it("reuses one TUI terminal per conversation", async () => {
    const terminal = new MockTerminalLauncher()
    const service = new AgentSymphonyService(new MemoryMessageBus(), new MockOpenCodeRunner(), terminal)
    const conversation = await service.createConversation({ title: "reuse", initialMessage: "Start work.", openTui: true })

    const first = await service.openConversation(conversation.id)
    const second = await service.openConversation(conversation.id)

    expect(terminal.launches).toHaveLength(1)
    expect(first.window.reused).toBe(true)
    expect(second.window.reused).toBe(true)
    expect(first.window.pid).toBe(second.window.pid)
  })

  it("returns detailed conversation state", async () => {
    const service = new AgentSymphonyService(new MemoryMessageBus(), new MockOpenCodeRunner(), new MockTerminalLauncher())
    const conversation = await service.createConversation({ title: "detail", initialMessage: "Hello." })

    const detail = await service.getConversation(conversation.id)

    expect(detail.conversation.id).toBe(conversation.id)
    expect(detail.messageCount).toBe(2)
    expect(detail.lastMessage?.role).toBe("child")
    expect(detail.lastMessage?.content).toContain("Hello.")
  })
})
