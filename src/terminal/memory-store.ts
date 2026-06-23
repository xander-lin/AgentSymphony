import type { TerminalWindowRecord } from "./launcher.ts"
import type { TerminalWindowStore } from "./store.ts"

export class MemoryTerminalWindowStore implements TerminalWindowStore {
  private readonly windows = new Map<string, TerminalWindowRecord>()

  async get(conversationId: string): Promise<TerminalWindowRecord | undefined> {
    return this.windows.get(conversationId)
  }

  async set(record: TerminalWindowRecord): Promise<void> {
    this.windows.set(record.conversationId, record)
  }

  async delete(conversationId: string): Promise<void> {
    this.windows.delete(conversationId)
  }
}
