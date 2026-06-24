import { describe, expect, it } from "vitest"
import { deleteVisibleTeammate } from "../src/plugin.ts"

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
