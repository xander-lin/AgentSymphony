import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { launchHubReceiver } from "../src/hub/receiver-launcher.ts"

describe("launchHubReceiver", () => {
  it("waits for a newly registered receiver instance", async () => {
    const hub = new MemoryAgentSymphonyHub()
    await hub.registerInstance({ id: "existing", name: "existing", directory: "/repo" })

    const launched = await launchHubReceiver({
      hub,
      directory: "/repo",
      prompt: "bootstrap",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [{ id: "ses_receiver", directory: "/repo", title: "bootstrap", time_created: 2, time_updated: 2 }],
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    expect(launched.pid).toBe(123)
    expect(launched.prompt).toBe("bootstrap")
    expect(launched.sessionId).toBe("ses_receiver")
    expect(launched.instance).toMatchObject({ id: "receiver" })
  })
})
