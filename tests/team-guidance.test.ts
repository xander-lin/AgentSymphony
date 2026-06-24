import { describe, expect, it } from "vitest"
import { AgentSymphonyPlugin } from "../src/plugin.ts"

describe("team system guidance", () => {
  it("adds teammate workflow guidance to chat system prompts", async () => {
    const hooks = await AgentSymphonyPlugin({
      client: {} as never,
      project: {} as never,
      directory: "/repo",
      worktree: "/repo",
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:4777"),
      $: {} as never,
    })
    const output = { system: ["base"] }

    await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses", model: {} as never }, output)

    expect(output.system).toHaveLength(2)
    expect(output.system[1]).toContain("Team workflow guidance")
    expect(output.system[1]).toContain("launch teammates")
    expect(output.system[1]).toContain("Model selection")
    expect(output.system[1]).toContain("agentsymphony_hub_launch_receiver")
  })
})
