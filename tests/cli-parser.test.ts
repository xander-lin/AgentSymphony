import { describe, expect, it } from "vitest"

describe("opencode JSON output shape", () => {
  it("extracts session id and text from a streamed event line", async () => {
    const { parseRunOutputForTest } = await import("../src/runtime/cli.ts")
    const payload = [
      JSON.stringify({ type: "step_start", sessionID: "ses_test", part: { type: "step-start", sessionID: "ses_test" } }),
      JSON.stringify({ type: "text", sessionID: "ses_test", part: { type: "text", sessionID: "ses_test", text: "hello" } }),
      JSON.stringify({ type: "step_finish", sessionID: "ses_test", part: { type: "step-finish", sessionID: "ses_test" } }),
    ].join("\n")

    expect(parseRunOutputForTest(payload)).toEqual({ output: "hello", sessionId: "ses_test" })
  })
})
