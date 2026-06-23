import type { MessageBus } from "../messages/types.ts"
import type { OpenCodeRunner } from "../runtime/runner.ts"
import { createId } from "../shared/id.ts"
import type { TerminalLauncher } from "../terminal/launcher.ts"

export interface CreateConversationInput {
  title: string
  initialMessage?: string
  agent?: string
  model?: string
  directory?: string
  openTui?: boolean
}

export interface SendMessageInput {
  conversationId: string
  message: string
  openTui?: boolean
}

export class AgentSymphonyService {
  constructor(
    private readonly bus: MessageBus,
    private readonly runner: OpenCodeRunner,
    private readonly terminal: TerminalLauncher,
  ) {}

  async createConversation(input: CreateConversationInput) {
    const conversation = await this.bus.createConversation({
      id: createId("conv"),
      title: input.title,
      agent: input.agent,
      model: input.model,
      directory: input.directory,
    })

    if (!input.initialMessage) return conversation

    const result = await this.sendMessage({ conversationId: conversation.id, message: input.initialMessage, openTui: input.openTui })
    return result.conversation
  }

  async sendMessage(input: SendMessageInput) {
    const conversation = await this.bus.getConversation(input.conversationId)
    if (!conversation) throw new Error(`Unknown AgentSymphony conversation: ${input.conversationId}`)

    await this.bus.appendMessage({
      conversationId: conversation.id,
      role: "parent",
      content: input.message,
      opencodeSessionId: conversation.sessionId,
    })

    try {
      const result = await this.runner.run({
        message: input.message,
        sessionId: conversation.sessionId,
        title: conversation.title,
        agent: conversation.agent,
        model: conversation.model,
        directory: conversation.directory,
      })
      const updated = await this.bus.updateConversation({
        ...conversation,
        sessionId: result.sessionId ?? conversation.sessionId,
        status: "active",
      })
      const response = await this.bus.appendMessage({
        conversationId: conversation.id,
        role: "child",
        content: result.output,
        opencodeSessionId: updated.sessionId,
      })
      if (input.openTui) await this.openConversation(updated.id)
      return { conversation: updated, response }
    } catch (error) {
      await this.bus.updateConversation({ ...conversation, status: "failed" })
      throw error
    }
  }

  async readMessages(conversationId: string, since?: string) {
    const conversation = await this.bus.getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown AgentSymphony conversation: ${conversationId}`)
    return this.bus.listMessages(conversationId, since)
  }

  async getConversation(conversationId: string) {
    const conversation = await this.bus.getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown AgentSymphony conversation: ${conversationId}`)
    const messages = await this.bus.listMessages(conversationId)
    return {
      conversation,
      messages,
      messageCount: messages.length,
      lastMessage: messages.at(-1),
    }
  }

  async listConversations() {
    return this.bus.listConversations()
  }

  async openConversation(conversationId: string) {
    const conversation = await this.bus.getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown AgentSymphony conversation: ${conversationId}`)
    if (!conversation.sessionId) throw new Error(`Conversation has no OpenCode session yet: ${conversationId}`)

    const window = await this.terminal.launch({
      conversationId: conversation.id,
      sessionId: conversation.sessionId,
      title: conversation.title,
      directory: conversation.directory,
    })
    return { conversation, window }
  }
}
