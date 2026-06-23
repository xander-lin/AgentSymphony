import { describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileInstanceIdentityStore } from "../src/instance/identity.ts"

describe("FileInstanceIdentityStore", () => {
  it("persists one identity per opencode session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-identity-"))
    try {
      const first = await new FileInstanceIdentityStore().load(directory, "ses_sender")
      const second = await new FileInstanceIdentityStore().load(directory, "ses_sender")

      expect(first).toEqual(second)
      expect(first.name).toContain("ses_sender")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("keeps different sessions separate in one workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-identity-"))
    try {
      const sender = await new FileInstanceIdentityStore().load(directory, "ses_sender")
      const receiver = await new FileInstanceIdentityStore().load(directory, "ses_receiver")

      expect(sender.id).not.toBe(receiver.id)
      expect(sender.name).toContain("ses_sender")
      expect(receiver.name).toContain("ses_receiver")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("keeps pre-session identities process local", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-identity-"))
    try {
      const first = await new FileInstanceIdentityStore().load(directory)
      const second = await new FileInstanceIdentityStore().load(directory)

      expect(first.id).not.toBe(second.id)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("adopts the process identity when first binding a session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-identity-"))
    try {
      const store = new FileInstanceIdentityStore()
      const processIdentity = await store.load(directory)
      const sessionIdentity = await store.load(directory, "ses_adopt", processIdentity)
      const reloaded = await new FileInstanceIdentityStore().load(directory, "ses_adopt")

      expect(sessionIdentity.id).toBe(processIdentity.id)
      expect(reloaded.id).toBe(processIdentity.id)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
