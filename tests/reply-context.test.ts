import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileReplyContextStore, MemoryReplyContextStore } from "../src/hub/reply-context.ts"

const stubInstanceId = "inst_test"

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
      toInstanceId: "",
      messageId: "hubmsg_1",
    })
    await expect(store.getByThread("reviewer")).resolves.toMatchObject({ conversationId: "conv_1" })
    await expect(store.list()).resolves.toHaveLength(1)
  })
})

describe("FileReplyContextStore", () => {
  it("persists reply contexts across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-reply-context-"))
    try {
      const first = new FileReplyContextStore(directory, () => stubInstanceId)
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

      const second = new FileReplyContextStore(directory, () => stubInstanceId)
      await expect(second.getLatest()).resolves.toMatchObject({
        threadName: "reviewer",
        conversationId: "conv_1",
        toInstanceId: stubInstanceId,
      })
      await expect(second.getByThread("reviewer")).resolves.toMatchObject({ messageId: "hubmsg_1" })
      await expect(second.list()).resolves.toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("isolates reply contexts by instance id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-reply-context-"))
    try {
      const storeA = new FileReplyContextStore(directory, () => "inst_a")
      const storeB = new FileReplyContextStore(directory, () => "inst_b")

      await storeA.setFromMessage({
        threadName: "thread-a",
        createdByThisInstance: false,
        message: {
          id: "hubmsg_a",
          conversationId: "conv_a",
          fromInstanceId: "inst_leader",
          toInstanceId: "inst_a",
          content: "hello a",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "delivered",
        },
      })

      await storeB.setFromMessage({
        threadName: "thread-b",
        createdByThisInstance: false,
        message: {
          id: "hubmsg_b",
          conversationId: "conv_b",
          fromInstanceId: "inst_leader",
          toInstanceId: "inst_b",
          content: "hello b",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "delivered",
        },
      })

      await expect(storeA.getLatest()).resolves.toMatchObject({ threadName: "thread-a", toInstanceId: "inst_a" })
      await expect(storeB.getLatest()).resolves.toMatchObject({ threadName: "thread-b", toInstanceId: "inst_b" })
      await expect(storeA.list()).resolves.toHaveLength(1)
      await expect(storeB.list()).resolves.toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
