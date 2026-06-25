import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { KittyReceiverLauncher } from "../src/hub/kitty-launcher.ts"
import { MemoryInstanceIdentityStore } from "../src/instance/memory.ts"
import { MemoryHubStore } from "../src/hub/memory-store.ts"

const receiverIdentity = { id: "receiver", name: "receiver", directory: "/repo" }

describe("KittyReceiverLauncher", () => {
  it("launches and returns receiver instance", async () => {
    const hub = new MemoryAgentSymphonyHub({}, new MemoryHubStore())
    const launcher = new KittyReceiverLauncher()

    const launched = await launcher.launch({
      hub,
      directory: "/repo",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [],
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "test-rcv", name: "receiver", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    expect(launched.instance.id).toBe("test-rcv")
    expect(launched.pid).toBe(123)
  })

  it("resumes and returns receiver instance", async () => {
    const hub = new MemoryAgentSymphonyHub({}, new MemoryHubStore())
    const launcher = new KittyReceiverLauncher()

    const resumed = await launcher.resume({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: new MemoryInstanceIdentityStore(receiverIdentity),
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(resumed.instance.id).toBe("receiver")
    expect(resumed.pid).toBe(456)
    expect(resumed.reused).toBe(false)
  })

  it("getChildPids returns empty for no matching processes", async () => {
    const launcher = new KittyReceiverLauncher()
    const pids = await launcher.getChildPids("nonexistent-session")
    expect(pids).toEqual([])
  })
})
