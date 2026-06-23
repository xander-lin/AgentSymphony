import { describe, expect, it } from "vitest"
import { FileInstanceIdentityStore } from "../src/instance/identity.ts"

describe("FileInstanceIdentityStore", () => {
  it("creates a process-local identity instead of sharing one by directory", async () => {
    const first = await new FileInstanceIdentityStore().load("/repo")
    const second = await new FileInstanceIdentityStore().load("/repo")

    expect(first.id).not.toBe(second.id)
    expect(first.name).toContain(String(process.pid))
    expect(second.name).toContain(String(process.pid))
  })

  it("returns the same identity from one store instance", async () => {
    const store = new FileInstanceIdentityStore()
    const first = await store.load("/repo")
    const second = await store.load("/repo")

    expect(first).toEqual(second)
  })
})
