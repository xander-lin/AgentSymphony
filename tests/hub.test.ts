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

  it("preserves per-message variants without changing conversations", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "variant task" })

    const sent = await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Use more reasoning.", variant: "high" })
    const [inbox] = await hub.pollMessages(child.id)

    expect(sent.variant).toBe("high")
    expect(inbox?.variant).toBe("high")
  })

  it("allows multiple conversations between the same two instances", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })

    const first = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "first", threadName: "first" })
    const second = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "second", threadName: "second" })
    const reversed = await hub.createConversation({ parentInstanceId: child.id, targetInstanceId: parent.id, title: "reverse", threadName: "reverse" })

    expect(second.id).not.toEqual(first.id)
    expect(reversed.id).not.toEqual(first.id)
    expect(second.threadName).toBe("second")
    expect(reversed.threadName).toBe("reverse")

    const list = await hub.listConversationsForInstance(parent.id)
    expect(list.map((c) => c.id).sort()).toEqual([first.id, second.id, reversed.id].sort())
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

  it("keeps stale instances in monitor snapshots as offline history", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const hub = new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now })
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "historical", threadName: "historical" })

    now = new Date("2026-01-01T00:00:02.000Z")
    await hub.heartbeat(parent.id)
    const snapshot = await hub.getMonitorSnapshot()

    expect(snapshot.instances).toEqual([expect.objectContaining({ id: parent.id, online: true }), expect.objectContaining({ id: child.id, online: false })])
    expect(snapshot.conversations).toEqual([expect.objectContaining({ targetInstanceId: child.id })])
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

  it("archives a thread and removes unused offline teammate records", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const hub = new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now })
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "Worker", threadName: "worker" })
    await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "one" })

    now = new Date("2026-01-01T00:00:02.000Z")
    await hub.heartbeat(parent.id)
    const archived = await hub.archiveThread("worker")
    const snapshot = await hub.getMonitorSnapshot()

    expect(archived.conversation).toMatchObject({ threadName: "worker" })
    expect(archived.removedMessages).toBe(1)
    expect(archived.removedInstances).toEqual([expect.objectContaining({ id: child.id })])
    expect(snapshot.conversations).toEqual([])
    expect(snapshot.messages).toEqual([])
    expect(snapshot.instances).toEqual([expect.objectContaining({ id: parent.id })])
  })

  it("deletes an offline instance and its related hub history", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const hub = new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now })
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ name: "child", directory: "/repo" })
    const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "Worker", threadName: "worker" })
    await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "one" })

    now = new Date("2026-01-01T00:00:02.000Z")
    await hub.heartbeat(parent.id)
    const deleted = await hub.deleteInstance(child.id)
    const snapshot = await hub.getMonitorSnapshot()

    expect(deleted.instance).toMatchObject({ id: child.id })
    expect(deleted.removedConversations).toEqual([expect.objectContaining({ threadName: "worker" })])
    expect(deleted.removedMessages).toBe(1)
    expect(snapshot.instances).toEqual([expect.objectContaining({ id: parent.id })])
    expect(snapshot.conversations).toEqual([])
    expect(snapshot.messages).toEqual([])
  })

  it("rejects deleting live instances", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const instance = await hub.registerInstance({ name: "live", directory: "/repo" })

    await expect(hub.deleteInstance(instance.id)).rejects.toThrow(/Cannot delete live/)
  })
})
