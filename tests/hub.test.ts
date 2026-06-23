import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { MockTuiController } from "../src/tui/mock.ts"

describe("MemoryAgentSymphonyHub", () => {
  it("routes queued messages between registered opencode instances", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "child task", threadName: "builder" })

    const sent = await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Do the child task." })
    const inbox = await hub.pollMessages(child.id)

    expect(sent.toInstanceId).toBe(child.id)
    expect(conversation.createdByInstanceId).toBe(parent.id)
    expect(conversation.threadName).toBe("builder")
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.content).toBe("Do the child task.")
    expect(inbox[0]?.status).toBe("delivered")
  })

  it("lets a target plugin inject a routed message into its TUI", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "child task" })
    const tui = new MockTuiController()

    await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Injected via hub." })
    const [message] = await hub.pollMessages(child.id)
    if (!message) throw new Error("Expected routed message")
    await tui.injectPrompt(message.content)
    await hub.acknowledgeMessage(message.id)

    expect(tui.prompts).toEqual(["Injected via hub."])
    await expect(hub.acknowledgeMessage(message.id)).resolves.toMatchObject({ status: "acknowledged" })
  })

  it("filters stale instances and rejects stale routing targets", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const hub = new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now })
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })

    now = new Date("2026-01-01T00:00:02.000Z")

    expect(await hub.listInstances()).toEqual([])
    await expect(hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "stale" })).rejects.toThrow(/Stale parent instance/)
  })

  it("rejects messages when the other side becomes stale", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const hub = new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now })
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "task" })

    now = new Date("2026-01-01T00:00:02.000Z")
    await hub.heartbeat(parent.id)

    await expect(hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "hello" })).rejects.toThrow(/Stale target instance/)
  })

  it("lists conversations and recent messages for an instance", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "History", threadName: "history" })
    await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "one" })
    await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: child.id, content: "two" })

    await expect(hub.listConversationsForInstance(parent.id)).resolves.toEqual([expect.objectContaining({ threadName: "history" })])
    await expect(hub.listMessagesForConversation(conversation.id, 1)).resolves.toEqual([expect.objectContaining({ content: "two" })])
  })
})
