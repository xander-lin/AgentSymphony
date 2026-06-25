import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { startHubConnector } from "../src/hub/connector.ts"
import { MemoryReplyContextStore } from "../src/hub/reply-context.ts"
import { MockTuiController } from "../src/tui/mock.ts"

describe("startHubConnector", () => {
  it("waits to register until a session identity is available", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const tui = new MockTuiController()
    const replyContext = new MemoryReplyContextStore()
    let identity: { id: string; name: string; directory: string } | undefined
    const connector = startHubConnector({
      hub,
      tui,
      replyContext,
      pollIntervalMs: 10,
      identity: () => identity,
    })

    try {
      await waitFor(() => connector.getStatus().error === "Waiting for OpenCode session identity.")
      expect(await hub.listInstances()).toEqual([])

      identity = { id: "child", name: "child", directory: "/repo" }
      await waitFor(() => connector.getStatus().connected)
      expect(await hub.listInstances()).toEqual([expect.objectContaining({ id: "child" })])
    } finally {
      connector.stop()
    }
  })

  it("continues processing remaining messages when tui injection fails for one message", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const tui = new MockTuiController()
    const replyContext = new MemoryReplyContextStore()
    const connector = startHubConnector({
      hub,
      tui,
      replyContext,
      pollIntervalMs: 10,
      identity: { id: "child", name: "child", directory: "/repo" },
    })

    try {
      await waitFor(() => connector.getStatus().connected)
      const status = connector.getStatus()
      if (!status.connected) throw new Error("Expected connector to be connected")

      const conv1 = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: status.instance.id, title: "first", threadName: "first" })
      const conv2 = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: status.instance.id, title: "second", threadName: "second" })
      await hub.sendMessage({ conversationId: conv1.id, fromInstanceId: parent.id, content: "message one" })
      await hub.sendMessage({ conversationId: conv2.id, fromInstanceId: parent.id, content: "message two" })

      tui.rejectOnNext = "injection failure"

      await waitFor(() => tui.prompts.length >= 1)

      expect(tui.prompts.some((p) => p.includes("message two"))).toBe(true)
      expect(tui.prompts.some((p) => p.includes("message one"))).toBe(false)

      const remaining = await hub.pollMessages(status.instance.id)
      expect(remaining).toHaveLength(0)
    } finally {
      connector.stop()
    }
  })

  it("polls hub messages and injects them into the local TUI", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ name: "parent", directory: "/repo" })
    const tui = new MockTuiController()
    const replyContext = new MemoryReplyContextStore()
    const connector = startHubConnector({
      hub,
      tui,
      replyContext,
      pollIntervalMs: 10,
      identity: { id: "child", name: "child", directory: "/repo" },
    })

    try {
      await waitFor(() => connector.getStatus().connected)
      const status = connector.getStatus()
      if (!status.connected) throw new Error("Expected connector to be connected")
      const conversation = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: status.instance.id, title: "task", threadName: "reviewer" })
      await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Injected through connector.", variant: "high" })
      await waitFor(() => tui.prompts.length === 1)

      expect(tui.prompts).toHaveLength(1)
      expect(tui.prompts[0]).not.toContain(conversation.id)
      expect(tui.prompts[0]).toContain("<<<AGENTSYMPHONY:reviewer>>>")
      expect(tui.prompts[0]).toContain("Thread: reviewer")
      expect(tui.prompts[0]).not.toContain("agentsymphony_hub_reply")
      expect(tui.prompts[0]).toContain("Injected through connector.")
      expect(tui.variants).toEqual(["high"])
      await expect(replyContext.getLatest()).resolves.toMatchObject({ conversationId: conversation.id, threadName: "reviewer", createdByThisInstance: false })
      await expect(replyContext.getByThread("reviewer")).resolves.toMatchObject({ conversationId: conversation.id })
      expect(await hub.pollMessages(status.instance.id)).toEqual([])
    } finally {
      connector.stop()
    }
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for predicate")
}
