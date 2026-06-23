export type ConversationStatus = "created" | "active" | "failed"

export interface ConversationRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: ConversationStatus
  sessionId?: string
  agent?: string
  model?: string
  directory?: string
}

export type MessageRole = "parent" | "child" | "system"

export interface ConversationMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  createdAt: string
  opencodeSessionId?: string
}

export interface MessageBus {
  createConversation(input: Omit<ConversationRecord, "createdAt" | "updatedAt" | "status">): Promise<ConversationRecord>
  updateConversation(conversation: ConversationRecord): Promise<ConversationRecord>
  getConversation(id: string): Promise<ConversationRecord | undefined>
  listConversations(): Promise<ConversationRecord[]>
  appendMessage(message: Omit<ConversationMessage, "id" | "createdAt">): Promise<ConversationMessage>
  listMessages(conversationId: string, since?: string): Promise<ConversationMessage[]>
}
