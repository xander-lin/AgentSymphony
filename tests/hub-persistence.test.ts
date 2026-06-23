import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileHubStore } from "../src/hub/file-store.ts"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"

describe("persistent hub store", () => {
  it("keeps conversations and queued messages across hub instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-hub-store-"))
    const storePath = join(directory, "hub-store.json")
    try {
      const firstHub = new MemoryAgentSymphonyHub({}, new FileHubStore(storePath))
      const parent = await firstHub.registerInstance({ id: "parent", name: "parent", directory: "/repo" })
      const child = await firstHub.registerInstance({ id: "child", name: "child", directory: "/repo" })
      const conversation = await firstHub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "Persisted", threadName: "persisted" })
      const sent = await firstHub.sendMessage({ conversationId: conversation.id, fromInstanceId: parent.id, content: "Persist me." })

      const secondHub = new MemoryAgentSymphonyHub({}, new FileHubStore(storePath))
      await expect(secondHub.getConversation(conversation.id)).resolves.toMatchObject({ threadName: "persisted" })
      await expect(secondHub.pollMessages(child.id)).resolves.toEqual([expect.objectContaining({ id: sent.id, content: "Persist me.", status: "delivered" })])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
