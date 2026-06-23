import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileTerminalWindowStore } from "../src/terminal/file-store.ts"
import type { TerminalWindowRecord } from "../src/terminal/launcher.ts"

describe("FileTerminalWindowStore", () => {
  it("persists terminal window records across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-window-store-"))
    try {
      const record: TerminalWindowRecord = {
        conversationId: "conv_1",
        sessionId: "ses_1",
        title: "test",
        pid: process.pid,
        launchedAt: new Date().toISOString(),
        reused: false,
      }

      await new FileTerminalWindowStore(directory).set(record)
      const loaded = await new FileTerminalWindowStore(directory).get("conv_1")

      expect(loaded).toEqual(record)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
