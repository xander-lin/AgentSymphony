import { describe, expect, it } from "vitest"
import { deleteVisibleTeammate, sendInitialHubMessage } from "../src/plugin.ts"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"

const conversation = {
  id: "conv",
  threadName: "worker",
  createdByInstanceId: "parent",
  parentInstanceId: "parent",
  targetInstanceId: "child",
  title: "Worker",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
}

describe("deleteVisibleTeammate", () => {
  it("deletes a teammate connected to the current instance", async () => {
    const deleted = await deleteVisibleTeammate(
      {
        async listConversationsForInstance() {
          return [conversation]
        },
        async deleteInstance(instanceId: string) {
          return { instance: { id: instanceId, name: "child", directory: "/repo", registeredAt: conversation.createdAt, lastSeenAt: conversation.updatedAt }, removedConversations: [conversation], removedMessages: 1 }
        },
      },
      "parent",
      "child",
    )

    expect(deleted.instance).toMatchObject({ id: "child" })
    expect(deleted.removedConversations).toEqual([conversation])
  })

  it("rejects deleting self or unrelated instances", async () => {
    const hub = {
      async listConversationsForInstance() {
        return [conversation]
      },
      async deleteInstance() {
        throw new Error("deleteInstance should not be called")
      },
    }

    await expect(deleteVisibleTeammate(hub, "parent", "parent")).rejects.toThrow(/outside this session/)
    await expect(deleteVisibleTeammate(hub, "parent", "unrelated")).rejects.toThrow(/outside this session/)
  })
})

describe("sendInitialHubMessage", () => {
  it("queues first teammate task through the hub", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ id: "parent", name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ id: "child", name: "child", directory: "/repo" })
    const created = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "worker", threadName: "worker" })

    const message = await sendInitialHubMessage({ hub, directory: "/repo", fromInstanceId: parent.id, conversation: created, content: "Do the first task." })

    expect(message).toMatchObject({ content: "Do the first task.", fromInstanceId: parent.id, toInstanceId: child.id })
    await expect(hub.pollMessages(child.id)).resolves.toEqual([expect.objectContaining({ content: "Do the first task." })])
  })

  it("does not queue an empty first teammate task", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const parent = await hub.registerInstance({ id: "parent", name: "parent", directory: "/repo" })
    const child = await hub.registerInstance({ id: "child", name: "child", directory: "/repo" })
    const created = await hub.createConversation({ parentInstanceId: parent.id, targetInstanceId: child.id, title: "worker", threadName: "worker" })

    await expect(sendInitialHubMessage({ hub, directory: "/repo", fromInstanceId: parent.id, conversation: created, content: "   " })).resolves.toBeUndefined()
    await expect(hub.pollMessages(child.id)).resolves.toEqual([])
  })
})
