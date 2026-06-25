import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { launchHubReceiver, resumeHubReceiver } from "../src/hub/receiver-launcher.ts"
import { MemoryInstanceIdentityStore } from "../src/instance/memory.ts"

const receiverIdentity = { id: "receiver", name: "receiver", directory: "/repo" }

describe("receiver launcher", () => {
  it("waits for a newly registered receiver instance", async () => {
    const hub = new MemoryAgentSymphonyHub()
    let launchOptions: unknown
    await hub.registerInstance({ id: "existing", name: "existing", directory: "/repo" })

    const launched = await launchHubReceiver({
      hub,
      directory: "/repo",
      model: "opencode-go/deepseek-v4-pro",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [{ id: "ses_receiver", directory: "/repo", title: "bootstrap", time_created: 2, time_updated: 2 }],
      spawnReceiver(_directory, _title, _prompt, options) {
        launchOptions = options
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    expect(launched.pid).toBe(123)
    expect(launched.prompt).toContain("receiver registration only")
    expect(launched.sessionId).toBe("ses_receiver")
    expect(launched.model).toBe("opencode-go/deepseek-v4-pro")
    expect(launchOptions).toEqual({ model: "opencode-go/deepseek-v4-pro" })
    expect(launched.instance).toMatchObject({ id: "receiver" })
  })

  it("does not fail a launch when session discovery fails after registration", async () => {
    const hub = new MemoryAgentSymphonyHub()

    const launched = await launchHubReceiver({
      hub,
      directory: "/repo",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => {
        throw new Error("sqlite busy")
      },
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    expect(launched.sessionId).toBeUndefined()
    expect(launched.instance).toMatchObject({ id: "receiver" })
  })

  it("uses a default launch prompt that waits for injected messages instead of polling threads", async () => {
    const hub = new MemoryAgentSymphonyHub()
    let prompt = ""

    const launched = await launchHubReceiver({
      hub,
      directory: "/repo",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [],
      spawnReceiver(_directory, _title, value) {
        prompt = value
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    expect(launched.prompt).toBe(prompt)
    expect(prompt).toContain("Do not list, read, or poll AgentSymphony threads")
    expect(prompt).toContain("Wait for injected AgentSymphony messages")
    expect(prompt).not.toContain("agentsymphony_hub_read_thread")
  })

  it("serializes concurrent launch requests so each receiver is attributed once", async () => {
    const hub = new MemoryAgentSymphonyHub()

    const first = await launchHubReceiver({
      hub,
      directory: "/repo",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [],
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver-one", name: "receiver-one", directory: "/repo" }), 10)
        return { pid: 123, unref() {} }
      },
    })

    const second = await launchHubReceiver({
      hub,
      directory: "/repo",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      beforeSessions: [],
      listSessions: async () => [],
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver-two", name: "receiver-two", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(first.instance.id).toBe("receiver-one")
    expect(second.instance.id).toBe("receiver-two")
  })

  it("resumes an existing receiver session by stable session identity", async () => {
    const hub = new MemoryAgentSymphonyHub()
    let resumeOptions: unknown

    await hub.registerInstance({ id: "existing", name: "existing", directory: "/repo" })

    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      variant: "minimal",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: new MemoryInstanceIdentityStore(receiverIdentity),
      spawnReceiver(_directory, _title, _sessionId, _prompt, options) {
        resumeOptions = options
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(resumed.pid).toBe(456)
    expect(resumed.sessionId).toBe("ses_receiver")
    expect(resumed.variant).toBe("minimal")
    expect(resumeOptions).toEqual({ variant: "minimal" })
    expect(resumed.instance).toMatchObject(receiverIdentity)
  })

  it("always kills old processes and spawns a new receiver (no reuse)", async () => {
    const hub = new MemoryAgentSymphonyHub()
    await hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" })

    let spawned = false
    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: new MemoryInstanceIdentityStore(receiverIdentity),
      spawnReceiver() {
        spawned = true
        return { pid: 456, unref() {} }
      },
    })

    expect(spawned).toBe(true)
    expect(resumed.pid).toBe(456)
    expect(resumed.reused).toBe(false)
    expect(resumed.instance).toMatchObject({ id: "receiver" })
  })

  it("spawns a new receiver when old process has exited", async () => {
    const hub = new MemoryAgentSymphonyHub()

    const resumed = await resumeHubReceiver({
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

    expect(resumed.pid).toBe(456)
    expect(resumed.reused).toBe(false)
    expect(resumed.instance).toMatchObject({ id: "receiver" })
  })

  it("uses a default resume prompt that waits for injected messages instead of polling threads", async () => {
    const hub = new MemoryAgentSymphonyHub()
    let prompt = ""

    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: new MemoryInstanceIdentityStore(receiverIdentity),
      spawnReceiver(_directory, _title, _sessionId, value) {
        prompt = value
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(resumed.prompt).toBe(prompt)
    expect(prompt).toContain("Do not list, read, or poll AgentSymphony threads")
    expect(prompt).toContain("Wait for injected AgentSymphony messages")
    expect(prompt).not.toContain("agentsymphony_hub_read_thread")
  })
})
