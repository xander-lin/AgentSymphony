import { describe, expect, it } from "vitest"
import { OpenCodeTuiController } from "../src/tui/opencode.ts"

describe("OpenCodeTuiController", () => {
  it("injects prompts through session promptAsync", async () => {
    const calls: unknown[] = []
    const controller = new OpenCodeTuiController({
      session: {
        async promptAsync(input) {
          calls.push(input)
        },
      },
    }, () => "ses_receiver", "/repo")

    await controller.injectPrompt("hello")

    expect(calls).toEqual([{
      path: { id: "ses_receiver" },
      query: { directory: "/repo" },
      body: { parts: [{ type: "text", text: "hello" }], variant: undefined },
    }])
  })

  it("passes per-message variants through promptAsync", async () => {
    const calls: unknown[] = []
    const controller = new OpenCodeTuiController({
      session: {
        async promptAsync(input) {
          calls.push(input)
        },
      },
    }, () => "ses_receiver", "/repo")

    await controller.injectPrompt("hello", { variant: "high" })

    expect(calls).toEqual([expect.objectContaining({ body: { parts: [{ type: "text", text: "hello" }], variant: "high" } })])
  })

  it("requires a current session id", async () => {
    const controller = new OpenCodeTuiController({
      session: {
        async promptAsync() {},
      },
    }, () => undefined, "/repo")

    await expect(controller.injectPrompt("hello")).rejects.toThrow(/session id is not available/)
  })
})
