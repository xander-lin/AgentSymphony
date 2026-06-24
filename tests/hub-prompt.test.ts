import { describe, expect, it } from "vitest"
import { formatInjectedHubPrompt } from "../src/hub/prompt.ts"

describe("formatInjectedHubPrompt", () => {
  it("hides routing metadata and keeps tool guidance out of injected messages", () => {
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
    expect(prompt).toContain("<<<AGENTSYMPHONY:reviewer>>>")
    expect(prompt).toContain("<<<END AGENTSYMPHONY:reviewer>>>")
    expect(prompt).toContain("Thread: reviewer")
    expect(prompt).toContain("Origin: created elsewhere")
    expect(prompt).not.toContain("agentsymphony_hub_reply")
    expect(prompt).not.toContain("agentsymphony_hub_read_thread")
    expect(prompt).not.toContain("agentsymphony_hub_system_status")
    expect(prompt).not.toContain("messages are injected automatically")
    expect(prompt).not.toContain("do not poll")
    expect(prompt).toContain("Please review the API.")
  })

  it("uses a sanitized thread name in prompt boundaries", () => {
    const prompt = formatInjectedHubPrompt(
      {
        id: "hubmsg_1",
        conversationId: "conv_1",
        fromInstanceId: "inst_parent",
        toInstanceId: "inst_child",
        content: "hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "delivered",
      },
      {
        id: "conv_1",
        threadName: "review thread/alpha",
        createdByInstanceId: "inst_parent",
        parentInstanceId: "inst_parent",
        targetInstanceId: "inst_child",
        title: "Review task",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      true,
    )

    expect(prompt).toContain("<<<AGENTSYMPHONY:review_thread_alpha>>>")
    expect(prompt).toContain("Thread: review thread/alpha")
    expect(prompt).toContain("Origin: created here")
  })
})
