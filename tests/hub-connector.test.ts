import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { startHubConnector } from "../src/hub/connector.ts"
import { MemoryReplyContextStore } from "../src/hub/reply-context.ts"
import { MockTuiController } from "../src/tui/mock.ts"

describe("startHubConnector", () => {
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
      await hub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Injected through connector." })
      await waitFor(() => tui.prompts.length === 1)

      expect(tui.prompts).toHaveLength(1)
      expect(tui.prompts[0]).not.toContain(conversation.id)
      expect(tui.prompts[0]).toContain("thread 'reviewer'")
      expect(tui.prompts[0]).toContain("agentsymphony_hub_reply")
      expect(tui.prompts[0]).toContain("Injected through connector.")
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
