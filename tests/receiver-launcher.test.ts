import { describe, expect, it } from "vitest"
import { MemoryAgentSymphonyHub } from "../src/hub/memory.ts"
import { launchHubReceiver, resumeHubReceiver } from "../src/hub/receiver-launcher.ts"

describe("receiver launcher", () => {
  it("waits for a newly registered receiver instance", async () => {
    const hub = new MemoryAgentSymphonyHub()
    let launchOptions: unknown
    await hub.registerInstance({ id: "existing", name: "existing", directory: "/repo" })

    const launched = await launchHubReceiver({
      hub,
      directory: "/repo",
      prompt: "bootstrap",
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
    expect(launched.prompt).toBe("bootstrap")
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
      prompt: "bootstrap",
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

  it("resumes an existing receiver session by stable session identity", async () => {
    const hub = new MemoryAgentSymphonyHub()
    const identityFileWrites: Array<{ directory: string; sessionId: string }> = []
    let resumeOptions: unknown

    await hub.registerInstance({ id: "existing", name: "existing", directory: "/repo" })

    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      variant: "minimal",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: {
        async load(directory: string, sessionId?: string) {
          if (!sessionId) throw new Error("sessionId required")
          identityFileWrites.push({ directory, sessionId })
          return { id: "receiver", name: "receiver", directory }
        },
      },
      spawnReceiver(_directory, _title, _sessionId, _prompt, options) {
        resumeOptions = options
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(identityFileWrites).toEqual([{ directory: "/repo", sessionId: "ses_receiver" }])
    expect(resumed.pid).toBe(456)
    expect(resumed.sessionId).toBe("ses_receiver")
    expect(resumed.variant).toBe("minimal")
    expect(resumeOptions).toEqual({ variant: "minimal" })
    expect(resumed.instance).toMatchObject({ id: "receiver" })
  })

  it("reuses a live process when process id and session id match", async () => {
    const hub = new MemoryAgentSymphonyHub()
    await hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" })

    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      processId: 789,
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: { async load(directory: string) { return { id: "receiver", name: "receiver", directory } } },
      isSessionProcess: async (processId, sessionId) => processId === 789 && sessionId === "ses_receiver",
      spawnReceiver() {
        throw new Error("should not spawn")
      },
    })

    expect(resumed.pid).toBe(789)
    expect(resumed.reused).toBe(true)
    expect(resumed.instance).toMatchObject({ id: "receiver" })
  })

  it("spawns a replacement when process id does not match the session", async () => {
    const hub = new MemoryAgentSymphonyHub()

    const resumed = await resumeHubReceiver({
      hub,
      directory: "/repo",
      sessionId: "ses_receiver",
      processId: 789,
      timeoutMs: 1000,
      pollIntervalMs: 5,
      identityStore: { async load(directory: string) { return { id: "receiver", name: "receiver", directory } } },
      isSessionProcess: async () => false,
      spawnReceiver() {
        setTimeout(() => void hub.registerInstance({ id: "receiver", name: "receiver", directory: "/repo" }), 10)
        return { pid: 456, unref() {} }
      },
    })

    expect(resumed.pid).toBe(456)
    expect(resumed.reused).toBe(false)
    expect(resumed.instance).toMatchObject({ id: "receiver" })
  })
})
