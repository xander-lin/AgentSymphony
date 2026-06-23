import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ConversationMessage, ConversationRecord, MessageBus } from "./types.ts"
import { createId, nowIso } from "../shared/id.ts"

interface StoreFile {
  conversations: ConversationRecord[]
  messages: ConversationMessage[]
}

export class FileMessageBus implements MessageBus {
  private readonly filePath: string

  constructor(private readonly rootDirectory: string) {
    this.filePath = join(rootDirectory, ".agentsymphony", "store.json")
  }

  async createConversation(input: Omit<ConversationRecord, "createdAt" | "updatedAt" | "status">): Promise<ConversationRecord> {
    const store = await this.readStore()
    const timestamp = nowIso()
    const record: ConversationRecord = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "created",
    }
    store.conversations.push(record)
    await this.writeStore(store)
    return record
  }

  async updateConversation(conversation: ConversationRecord): Promise<ConversationRecord> {
    const store = await this.readStore()
    const updated = { ...conversation, updatedAt: nowIso() }
    const index = store.conversations.findIndex((record) => record.id === updated.id)
    if (index === -1) store.conversations.push(updated)
    else store.conversations[index] = updated
    await this.writeStore(store)
    return updated
  }

  async getConversation(id: string): Promise<ConversationRecord | undefined> {
    const store = await this.readStore()
    return store.conversations.find((record) => record.id === id)
  }

  async listConversations(): Promise<ConversationRecord[]> {
    const store = await this.readStore()
    return store.conversations.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async appendMessage(message: Omit<ConversationMessage, "id" | "createdAt">): Promise<ConversationMessage> {
    const store = await this.readStore()
    const record: ConversationMessage = {
      ...message,
      id: createId("msg"),
      createdAt: nowIso(),
    }
    store.messages.push(record)
    await this.writeStore(store)
    return record
  }

  async listMessages(conversationId: string, since?: string): Promise<ConversationMessage[]> {
    const store = await this.readStore()
    return store.messages.filter((message) => {
      if (message.conversationId !== conversationId) return false
      if (!since) return true
      return message.createdAt > since
    })
  }

  private async readStore(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      return JSON.parse(raw) as StoreFile
    } catch (error) {
      if (isMissingFileError(error)) return { conversations: [], messages: [] }
      throw error
    }
  }

  private async writeStore(store: StoreFile): Promise<void> {
    await mkdir(join(this.rootDirectory, ".agentsymphony"), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
