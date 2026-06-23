import type { TerminalWindowRecord } from "./launcher.ts"

export interface TerminalWindowStore {
  get(conversationId: string): Promise<TerminalWindowRecord | undefined>
  set(record: TerminalWindowRecord): Promise<void>
  delete(conversationId: string): Promise<void>
}
