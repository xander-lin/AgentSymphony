import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileReplyContextStore, MemoryReplyContextStore } from "../src/hub/reply-context.ts"

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

describe("FileReplyContextStore", () => {
  it("persists reply contexts across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-reply-context-"))
    const filePath = join(directory, "reply-context.json")
    try {
      const first = new FileReplyContextStore(filePath)
      await first.setFromMessage({
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

      const second = new FileReplyContextStore(filePath)
      await expect(second.getLatest()).resolves.toMatchObject({ threadName: "reviewer", conversationId: "conv_1" })
      await expect(second.getByThread("reviewer")).resolves.toMatchObject({ messageId: "hubmsg_1" })
      await expect(second.list()).resolves.toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
