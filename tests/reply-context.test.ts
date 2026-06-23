import { describe, expect, it } from "vitest"
import { MemoryReplyContextStore } from "../src/hub/reply-context.ts"

describe("MemoryReplyContextStore", () => {
  it("stores the latest inbound hub message context", async () => {
    const store = new MemoryReplyContextStore()

    await store.setFromMessage({
      threadName: "reviewer",
      createdByThisInstance: false,
      message: {
        id: "hubmsg_1",
        conversationId: "conv_1",
        fromInstanceId: "inst_parent",
        toInstanceId: "inst_child",
        content: "hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "delivered",
      },
    })

    await expect(store.getLatest()).resolves.toMatchObject({
      threadName: "reviewer",
      createdByThisInstance: false,
      conversationId: "conv_1",
      fromInstanceId: "inst_parent",
      messageId: "hubmsg_1",
    })
    await expect(store.getByThread("reviewer")).resolves.toMatchObject({ conversationId: "conv_1" })
    await expect(store.list()).resolves.toHaveLength(1)
  })
})
