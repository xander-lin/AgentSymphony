import { describe, expect, it } from "vitest"
import { offlineReceiverWarnings } from "../src/plugin.ts"

describe("offlineReceiverWarnings", () => {
  it("asks whether offline receivers should be resumed or deleted", async () => {
    const warnings = await offlineReceiverWarnings(
      {
        async getMonitorSnapshot() {
          return {
            instances: [
              { id: "parent", name: "parent", directory: "/repo", registeredAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:02.000Z", online: true },
              { id: "child", name: "child", directory: "/repo", registeredAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:01.000Z", online: false },
            ],
            conversations: [{ id: "conv", threadName: "worker", createdByInstanceId: "parent", parentInstanceId: "parent", targetInstanceId: "child", title: "Worker", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z" }],
            messages: [],
          }
        },
      },
      "/repo",
      { id: "parent", name: "parent", directory: "/repo" },
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        type: "hub.offline_receivers",
        decisionRequired: true,
        question: expect.stringContaining("resumed"),
        offlineReceivers: [
          expect.objectContaining({
            threadName: "worker",
            targetInstanceId: "child",
            choices: expect.objectContaining({
              resume: expect.objectContaining({ tool: "agentsymphony_hub_resume_receiver" }),
              delete: expect.objectContaining({ tool: "agentsymphony_hub_delete_teammate", targetInstanceId: "child" }),
            }),
          }),
        ],
      }),
    ])
  })

  it("returns no warnings when all related receivers are online", async () => {
    const warnings = await offlineReceiverWarnings(
      {
        async getMonitorSnapshot() {
          return {
            instances: [
              { id: "parent", name: "parent", directory: "/repo", registeredAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:02.000Z", online: true },
              { id: "child", name: "child", directory: "/repo", registeredAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:01.000Z", online: true },
            ],
            conversations: [{ id: "conv", threadName: "worker", createdByInstanceId: "parent", parentInstanceId: "parent", targetInstanceId: "child", title: "Worker", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z" }],
            messages: [],
          }
        },
      },
      "/repo",
      { id: "parent", name: "parent", directory: "/repo" },
    )

    expect(warnings).toEqual([])
  })
})
