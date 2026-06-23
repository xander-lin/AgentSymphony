import type { ConversationMessage, ConversationRecord, MessageBus } from "./types.ts"
import { createId, nowIso } from "../shared/id.ts"

export class MemoryMessageBus implements MessageBus {
  private conversations = new Map<string, ConversationRecord>()
  private messages: ConversationMessage[] = []

  async createConversation(input: Omit<ConversationRecord, "createdAt" | "updatedAt" | "status">): Promise<ConversationRecord> {
    const timestamp = nowIso()
    const record: ConversationRecord = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "created",
    }
    this.conversations.set(record.id, record)
    return record
  }

  async updateConversation(conversation: ConversationRecord): Promise<ConversationRecord> {
    const updated = { ...conversation, updatedAt: nowIso() }
    this.conversations.set(updated.id, updated)
    return updated
  }

  async getConversation(id: string): Promise<ConversationRecord | undefined> {
    return this.conversations.get(id)
  }

  async listConversations(): Promise<ConversationRecord[]> {
    return [...this.conversations.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async appendMessage(message: Omit<ConversationMessage, "id" | "createdAt">): Promise<ConversationMessage> {
    const record: ConversationMessage = {
      ...message,
      id: createId("msg"),
      createdAt: nowIso(),
    }
    this.messages.push(record)
    return record
  }

  async listMessages(conversationId: string, since?: string): Promise<ConversationMessage[]> {
    return this.messages.filter((message) => {
      if (message.conversationId !== conversationId) return false
      if (!since) return true
      return message.createdAt > since
    })
  }
}
