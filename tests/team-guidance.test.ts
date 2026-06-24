import { describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    expect(output.system[1]).toContain("team lead")
    expect(output.system[1]).toContain("team member")
    expect(output.system[1]).toContain("profitably split")
    expect(output.system[1]).toContain("continue using the team tools")
    expect(output.system[1]).toContain("Communicate early")
    expect(output.system[1]).toContain("launch more teammates")
    expect(output.system[1]).toContain("Model selection")
    expect(output.system[1]).toContain("do not rely on static built-in knowledge")
    expect(output.system[1]).toContain("Configured model catalog")
    expect(output.system[1]).toContain("agentsymphony_hub_launch_receiver")
  })

  it("includes configured model catalog capabilities in guidance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-model-catalog-"))
    try {
      await writeFile(join(directory, "agentsymphony.models.json"), JSON.stringify({
        models: [{
          id: "provider/fast-current",
          label: "Fast current model",
          strengths: ["cheap", "low latency"],
          bestFor: ["smoke tests", "formatting"],
          avoidFor: ["architecture review"],
          notes: "Configured by the user, not hard-coded by AgentSymphony.",
        }],
      }), "utf8")
      const hooks = await AgentSymphonyPlugin({
        client: {} as never,
        project: {} as never,
        directory,
        worktree: directory,
        experimental_workspace: { register() {} },
        serverUrl: new URL("http://127.0.0.1:4777"),
        $: {} as never,
      })
      const output = { system: [] as string[] }

      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses", model: {} as never }, output)

      expect(output.system[0]).toContain("provider/fast-current")
      expect(output.system[0]).toContain("cheap, low latency")
      expect(output.system[0]).toContain("architecture review")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
