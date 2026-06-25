import { createId } from "../shared/id.ts"
import type {
  AgentSymphonyHub,
  ArchiveHubThreadResult,
  CreateHubConversationInput,
  DeleteHubInstanceResult,
  HubConversation,
  HubInstance,
  HubMessage,
  RegisterInstanceInput,
  SendHubMessageInput,
} from "./types.ts"

export class MockAgentSymphonyHub implements AgentSymphonyHub {
  private instances = new Map<string, HubInstance>()
  private conversations = new Map<string, HubConversation>()
  private messages = new Map<string, HubMessage>()

  registerInstanceErrors: Error[] = []
  heartbeatErrors: Error[] = []
  createConversationErrors: Error[] = []
  sendMessageErrors: Error[] = []
  pollMessagesErrors: Error[] = []
  acknowledgeMessageErrors: Error[] = []
  deleteInstanceErrors: Error[] = []
  archiveThreadErrors: Error[] = []

  private _calls = {
    registerInstance: [] as RegisterInstanceInput[],
    heartbeat: [] as string[],
    createConversation: [] as CreateHubConversationInput[],
    sendMessage: [] as SendHubMessageInput[],
    pollMessages: [] as string[],
    acknowledgeMessage: [] as string[],
    deleteInstance: [] as string[],
    archiveThread: [] as string[],
  }

  get calls() {
    return this._calls
  }

  setInstance(instance: HubInstance): void {
    this.instances.set(instance.id, instance)
  }

  setConversation(conversation: HubConversation): void {
    this.conversations.set(conversation.id, conversation)
  }

  setMessage(message: HubMessage): void {
    this.messages.set(message.id, message)
  }

  reset(): void {
    this.instances.clear()
    this.conversations.clear()
    this.messages.clear()
    this._calls = {
      registerInstance: [],
      heartbeat: [],
      createConversation: [],
      sendMessage: [],
      pollMessages: [],
      acknowledgeMessage: [],
      deleteInstance: [],
      archiveThread: [],
    }
    this.registerInstanceErrors = []
    this.heartbeatErrors = []
    this.createConversationErrors = []
    this.sendMessageErrors = []
    this.pollMessagesErrors = []
    this.acknowledgeMessageErrors = []
    this.deleteInstanceErrors = []
    this.archiveThreadErrors = []
  }

  async registerInstance(input: RegisterInstanceInput): Promise<HubInstance> {
    this._calls.registerInstance.push(input)
    const error = this.registerInstanceErrors.shift()
    if (error) throw error
    const instance: HubInstance = {
      id: input.id ?? createId("inst"),
      name: input.name,
      directory: input.directory,
      tuiBaseUrl: input.tuiBaseUrl,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }
    this.instances.set(instance.id, instance)
    return instance
  }

  async heartbeat(instanceId: string): Promise<HubInstance> {
    this._calls.heartbeat.push(instanceId)
    const error = this.heartbeatErrors.shift()
    if (error) throw error
    const instance = this.instances.get(instanceId)
    if (!instance) throw new Error(`Unknown instance: ${instanceId}`)
    const updated = { ...instance, lastSeenAt: new Date().toISOString() }
    this.instances.set(instanceId, updated)
    return updated
  }

  async listInstances(): Promise<HubInstance[]> {
    return [...this.instances.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
  }

  async createConversation(input: CreateHubConversationInput): Promise<HubConversation> {
    this._calls.createConversation.push(input)
    const error = this.createConversationErrors.shift()
    if (error) throw error
    const conversation: HubConversation = {
      id: input.id ?? createId("conv"),
      threadName: input.threadName ?? input.title,
      createdByInstanceId: input.parentInstanceId,
      parentInstanceId: input.parentInstanceId,
      targetInstanceId: input.targetInstanceId,
      title: input.title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.conversations.set(conversation.id, conversation)
    return conversation
  }

  async getConversation(conversationId: string): Promise<HubConversation | undefined> {
    return this.conversations.get(conversationId)
  }

  async listConversationsForInstance(instanceId: string): Promise<HubConversation[]> {
    return [...this.conversations.values()]
      .filter((c) => c.parentInstanceId === instanceId || c.targetInstanceId === instanceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async archiveThread(threadName: string): Promise<ArchiveHubThreadResult> {
    this._calls.archiveThread.push(threadName)
    const error = this.archiveThreadErrors.shift()
    if (error) throw error
    const conversation = [...this.conversations.values()].find((c) => c.threadName === threadName)
    if (!conversation) return { removedMessages: 0, removedInstances: [] }
    this.conversations.delete(conversation.id)
    let removedMessages = 0
    for (const [id, msg] of this.messages) {
      if (msg.conversationId === conversation.id) {
        this.messages.delete(id)
        removedMessages++
      }
    }
    return { conversation, removedMessages, removedInstances: [] }
  }

  async deleteInstance(instanceId: string): Promise<DeleteHubInstanceResult> {
    this._calls.deleteInstance.push(instanceId)
    const error = this.deleteInstanceErrors.shift()
    if (error) throw error
    const instance = this.instances.get(instanceId)
    if (!instance) return { removedConversations: [], removedMessages: 0 }
    this.instances.delete(instanceId)
    const removedConversations = [...this.conversations.values()]
      .filter((c) => c.parentInstanceId === instanceId || c.targetInstanceId === instanceId)
    for (const c of removedConversations) {
      this.conversations.delete(c.id)
      for (const [id, msg] of this.messages) {
        if (msg.conversationId === c.id) this.messages.delete(id)
      }
    }
    return { instance, removedConversations, removedMessages: 0 }
  }

  async sendMessage(input: SendHubMessageInput): Promise<HubMessage> {
    this._calls.sendMessage.push(input)
    const error = this.sendMessageErrors.shift()
    if (error) throw error
    const conversation = this.conversations.get(input.conversationId)
    if (!conversation) throw new Error(`Unknown conversation: ${input.conversationId}`)
    const toInstanceId = input.fromInstanceId === conversation.parentInstanceId
      ? conversation.targetInstanceId
      : conversation.parentInstanceId
    const message: HubMessage = {
      id: createId("hubmsg"),
      conversationId: input.conversationId,
      fromInstanceId: input.fromInstanceId,
      toInstanceId,
      content: input.content,
      variant: input.variant,
      createdAt: new Date().toISOString(),
      status: "queued",
    }
    this.messages.set(message.id, message)
    return message
  }

  async listMessagesForConversation(conversationId: string, limit = 20): Promise<HubMessage[]> {
    return [...this.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit)
  }

  async pollMessages(instanceId: string): Promise<HubMessage[]> {
    this._calls.pollMessages.push(instanceId)
    const error = this.pollMessagesErrors.shift()
    if (error) throw error
    const queued = [...this.messages.values()]
      .filter((m) => m.toInstanceId === instanceId && m.status === "queued")
    for (const m of queued) {
      this.messages.set(m.id, { ...m, status: "delivered" })
    }
    return queued.map((m) => ({ ...m, status: "delivered" }))
  }

  async acknowledgeMessage(messageId: string): Promise<HubMessage | undefined> {
    this._calls.acknowledgeMessage.push(messageId)
    const error = this.acknowledgeMessageErrors.shift()
    if (error) throw error
    const message = this.messages.get(messageId)
    if (!message) return undefined
    const acknowledged = { ...message, status: "acknowledged" as const }
    this.messages.set(messageId, acknowledged)
    return acknowledged
  }

  async getMonitorSnapshot(): Promise<{ instances: HubInstance[]; conversations: HubConversation[]; messages: HubMessage[] }> {
    return {
      instances: [...this.instances.values()],
      conversations: [...this.conversations.values()],
      messages: [...this.messages.values()],
    }
  }
}
