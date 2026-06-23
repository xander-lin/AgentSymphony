import { describe, expect, it } from "vitest"
import { formatInjectedHubPrompt } from "../src/hub/prompt.ts"

describe("formatInjectedHubPrompt", () => {
  it("hides routing metadata and includes transparent reply instructions", () => {
    const prompt = formatInjectedHubPrompt(
      {
        id: "hubmsg_1",
        conversationId: "conv_1",
        fromInstanceId: "inst_parent",
        toInstanceId: "inst_child",
        content: "Please review the API.",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "delivered",
      },
      {
        id: "conv_1",
        threadName: "reviewer",
        createdByInstanceId: "inst_parent",
        parentInstanceId: "inst_parent",
        targetInstanceId: "inst_child",
        title: "Review task",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      false,
    )

    expect(prompt).not.toContain("conv_1")
    expect(prompt).not.toContain("inst_parent")
    expect(prompt).not.toContain("hubmsg_1")
    expect(prompt).toContain("thread 'reviewer'")
    expect(prompt).toContain("created by another OpenCode instance")
    expect(prompt).toContain("agentsymphony_hub_reply")
    expect(prompt).toContain("Please review the API.")
  })
})
