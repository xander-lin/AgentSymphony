import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { TerminalWindowRecord } from "./launcher.ts"
import type { TerminalWindowStore } from "./store.ts"

interface WindowStoreFile {
  windows: TerminalWindowRecord[]
}

export class FileTerminalWindowStore implements TerminalWindowStore {
  private readonly filePath: string

  constructor(private readonly rootDirectory: string) {
    this.filePath = join(rootDirectory, ".agentsymphony", "windows.json")
  }

  async get(conversationId: string): Promise<TerminalWindowRecord | undefined> {
    const store = await this.readStore()
    return store.windows.find((window) => window.conversationId === conversationId)
  }

  async set(record: TerminalWindowRecord): Promise<void> {
    const store = await this.readStore()
    const index = store.windows.findIndex((window) => window.conversationId === record.conversationId)
    if (index === -1) store.windows.push(record)
    else store.windows[index] = record
    await this.writeStore(store)
  }

  async delete(conversationId: string): Promise<void> {
    const store = await this.readStore()
    await this.writeStore({ windows: store.windows.filter((window) => window.conversationId !== conversationId) })
  }

  private async readStore(): Promise<WindowStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      return JSON.parse(raw) as WindowStoreFile
    } catch (error) {
      if (isMissingFileError(error)) return { windows: [] }
      throw error
    }
  }

  private async writeStore(store: WindowStoreFile): Promise<void> {
    await mkdir(join(this.rootDirectory, ".agentsymphony"), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
