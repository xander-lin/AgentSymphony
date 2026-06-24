import { describe, expect, it } from "vitest"
import { HttpAgentSymphonyHubClient } from "../src/hub/http-client.ts"
import { listenHubHttpServer } from "../src/hub/http-server.ts"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"

describe("HTTP AgentSymphony hub", () => {
  it("routes messages through the HTTP client", async () => {
    const server = await listenHubHttpServer(new MemoryAgentSymphonyHub(), 0)
    try {
      const client = new HttpAgentSymphonyHubClient(server.url)
      const parent = await client.registerInstance({ name: "parent", directory: "/repo" })
      const child = await client.registerInstance({ name: "child", directory: "/repo" })
      const conversation = await client.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "child task" })

      await client.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Route over HTTP." })
      const inbox = await client.pollMessages(child.id)
      const conversations = await client.listConversationsForInstance(parent.id)
      const messages = await client.listMessagesForConversation(conversation.id)
      const dashboard = await fetch(server.url).then((response) => response.text())
      const snapshot = await client.getMonitorSnapshot()

      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.content).toBe("Route over HTTP.")
      expect(inbox[0]?.toInstanceId).toBe(child.id)
      expect(conversations).toEqual([expect.objectContaining({ id: conversation.id })])
      expect(messages).toEqual([expect.objectContaining({ content: "Route over HTTP." })])
      expect(dashboard).toContain("AgentSymphony Hub")
      expect(snapshot.instances).toHaveLength(2)
      expect(snapshot.conversations).toHaveLength(1)
      expect(snapshot.messages).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  it("deletes offline instances through the HTTP client", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const server = await listenHubHttpServer(new MemoryAgentSymphonyHub({ instanceTtlMs: 1000, now: () => now }), 0)
    try {
      const client = new HttpAgentSymphonyHubClient(server.url)
      const parent = await client.registerInstance({ name: "parent", directory: "/repo" })
      const child = await client.registerInstance({ name: "child", directory: "/repo" })
      const conversation = await client.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "child task" })
      await client.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Route over HTTP." })

      now = new Date("2026-01-01T00:00:02.000Z")
      await client.heartbeat(parent.id)
      const deleted = await client.deleteInstance(child.id)
      const snapshot = await client.getMonitorSnapshot()

      expect(deleted.instance).toMatchObject({ id: child.id })
      expect(deleted.removedConversations).toHaveLength(1)
      expect(deleted.removedMessages).toBe(1)
      expect(snapshot.instances).toEqual([expect.objectContaining({ id: parent.id })])
      expect(snapshot.conversations).toEqual([])
      expect(snapshot.messages).toEqual([])
    } finally {
      await server.close()
    }
  })
})
