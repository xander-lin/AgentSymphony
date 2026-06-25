import { createId } from "../shared/id.ts"
import { MemoryHubStore } from "./memory-store.ts"
import type { HubStore } from "./store.ts"
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

export class MemoryAgentSymphonyHub implements AgentSymphonyHub {
  private writeQueue = Promise.resolve()
  private mutable: HubMaps | undefined

  constructor(
    private readonly options: { instanceTtlMs?: number; messageTtlMs?: number; pollLimit?: number; now?: () => Date } = {},
    private readonly store: HubStore = new MemoryHubStore(),
  ) {}

  async registerInstance(input: RegisterInstanceInput): Promise<HubInstance> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const timestamp = this.nowIso()
      const existing = input.id ? snapshot.instances.get(input.id) : undefined
      const instance: HubInstance = {
        ...existing,
        id: input.id ?? existing?.id ?? createId("inst"),
        name: input.name,
        directory: input.directory,
        tuiBaseUrl: input.tuiBaseUrl,
        registeredAt: existing?.registeredAt ?? timestamp,
        lastSeenAt: timestamp,
      }
      snapshot.instances.set(instance.id, instance)
      await this.saveSnapshot(snapshot)
      return instance
    })
  }

  async heartbeat(instanceId: string): Promise<HubInstance> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const instance = snapshot.instances.get(instanceId)
      if (!instance) throw new Error(`Unknown AgentSymphony instance: ${instanceId}`)
      const updated = { ...instance, lastSeenAt: this.nowIso() }
      snapshot.instances.set(updated.id, updated)
      await this.saveSnapshot(snapshot)
      return updated
    })
  }

  async listInstances(): Promise<HubInstance[]> {
    const snapshot = await this.loadSnapshot()
    return [...snapshot.instances.values()].filter((instance) => this.isLive(instance)).sort((left, right) => left.registeredAt.localeCompare(right.registeredAt))
  }

  async createConversation(input: CreateHubConversationInput): Promise<HubConversation> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      this.assertLiveInstance(snapshot, input.parentInstanceId, "parent")
      this.assertLiveInstance(snapshot, input.targetInstanceId, "target")

      const timestamp = this.nowIso()
      const conversation: HubConversation = {
        id: input.id ?? createId("conv"),
        threadName: input.threadName ?? input.title,
        createdByInstanceId: input.parentInstanceId,
        parentInstanceId: input.parentInstanceId,
        targetInstanceId: input.targetInstanceId,
        title: input.title,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      snapshot.conversations.set(conversation.id, conversation)
      await this.saveSnapshot(snapshot)
      return conversation
    })
  }

  async getConversation(conversationId: string): Promise<HubConversation | undefined> {
    const snapshot = await this.loadSnapshot()
    return snapshot.conversations.get(conversationId)
  }

  async listConversationsForInstance(instanceId: string): Promise<HubConversation[]> {
    const snapshot = await this.loadSnapshot()
    this.assertLiveInstance(snapshot, instanceId, "querying")
    return [...snapshot.conversations.values()]
      .filter((conversation) => conversation.parentInstanceId === instanceId || conversation.targetInstanceId === instanceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async archiveThread(threadName: string): Promise<ArchiveHubThreadResult> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const conversation = [...snapshot.conversations.values()].find((candidate) => candidate.threadName === threadName)
      if (!conversation) return { removedMessages: 0, removedInstances: [] }

      snapshot.conversations.delete(conversation.id)
      let removedMessages = 0
      for (const message of snapshot.messages.values()) {
        if (message.conversationId !== conversation.id) continue
        snapshot.messages.delete(message.id)
        removedMessages += 1
      }

      const connectedInstanceIds = new Set<string>()
      for (const remaining of snapshot.conversations.values()) {
        connectedInstanceIds.add(remaining.parentInstanceId)
        connectedInstanceIds.add(remaining.targetInstanceId)
      }

      const removedInstances: HubInstance[] = []
      for (const instanceId of [conversation.parentInstanceId, conversation.targetInstanceId]) {
        if (connectedInstanceIds.has(instanceId)) continue
        const instance = snapshot.instances.get(instanceId)
        if (!instance || this.isLive(instance)) continue
        snapshot.instances.delete(instanceId)
        removedInstances.push(instance)
      }

      await this.saveSnapshot(snapshot)
      return { conversation, removedMessages, removedInstances }
    })
  }

  async deleteInstance(instanceId: string): Promise<DeleteHubInstanceResult> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const instance = snapshot.instances.get(instanceId)
      if (!instance) return { removedConversations: [], removedMessages: 0 }
      if (this.isLive(instance)) throw new Error(`Cannot delete live AgentSymphony instance: ${instanceId}`)

      const removedConversations = [...snapshot.conversations.values()].filter((conversation) => conversation.parentInstanceId === instanceId || conversation.targetInstanceId === instanceId)
      const removedConversationIds = new Set(removedConversations.map((conversation) => conversation.id))
      for (const conversation of removedConversations) snapshot.conversations.delete(conversation.id)

      let removedMessages = 0
      for (const message of snapshot.messages.values()) {
        if (!removedConversationIds.has(message.conversationId) && message.fromInstanceId !== instanceId && message.toInstanceId !== instanceId) continue
        snapshot.messages.delete(message.id)
        removedMessages += 1
      }

      snapshot.instances.delete(instanceId)
      await this.saveSnapshot(snapshot)
      return { instance, removedConversations, removedMessages }
    })
  }

  async sendMessage(input: SendHubMessageInput): Promise<HubMessage> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const conversation = snapshot.conversations.get(input.conversationId)
      if (!conversation) throw new Error(`Unknown hub conversation: ${input.conversationId}`)
      this.assertLiveInstance(snapshot, input.fromInstanceId, "sender")
      const toInstanceId = input.fromInstanceId === conversation.parentInstanceId ? conversation.targetInstanceId : conversation.parentInstanceId
      this.assertLiveInstance(snapshot, toInstanceId, "target")

      const message: HubMessage = {
        id: createId("hubmsg"),
        conversationId: conversation.id,
        fromInstanceId: input.fromInstanceId,
        toInstanceId,
        content: input.content,
        variant: input.variant,
        createdAt: this.nowIso(),
        status: "queued",
      }
      snapshot.messages.set(message.id, message)
      snapshot.conversations.set(conversation.id, { ...conversation, updatedAt: message.createdAt })
      await this.saveSnapshot(snapshot)
      return message
    })
  }

  async listMessagesForConversation(conversationId: string, limit = 20): Promise<HubMessage[]> {
    const snapshot = await this.loadSnapshot()
    if (!snapshot.conversations.has(conversationId)) throw new Error(`Unknown hub conversation: ${conversationId}`)
    return [...snapshot.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-limit)
  }

  async pollMessages(instanceId: string): Promise<HubMessage[]> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      this.assertLiveInstance(snapshot, instanceId, "polling")
      const queued = [...snapshot.messages.values()]
        .filter((message) => message.toInstanceId === instanceId && message.status === "queued")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      const batch = queued.slice(0, this.options.pollLimit ?? 20)
      for (const message of batch) {
        snapshot.messages.set(message.id, { ...message, status: "delivered" })
      }
      await this.saveSnapshot(snapshot)
      return batch.map((message) => ({ ...message, status: "delivered" }))
    })
  }

  async acknowledgeMessage(messageId: string): Promise<HubMessage | undefined> {
    return this.write(async () => {
      const snapshot = await this.loadSnapshot()
      const message = snapshot.messages.get(messageId)
      if (!message) return undefined
      const acknowledged = { ...message, status: "acknowledged" as const }
      snapshot.messages.set(messageId, acknowledged)
      await this.saveSnapshot(snapshot)
      return acknowledged
    })
  }

  async getMonitorSnapshot(): Promise<{ instances: HubInstance[]; conversations: HubConversation[]; messages: HubMessage[] }> {
    const snapshot = await this.loadSnapshot()
    return {
      instances: [...snapshot.instances.values()].map((instance) => ({ ...instance, online: this.isLive(instance) })).sort((left, right) => left.registeredAt.localeCompare(right.registeredAt)),
      conversations: [...snapshot.conversations.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      messages: [...snapshot.messages.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    }
  }

  private assertLiveInstance(snapshot: HubMaps, instanceId: string, role: string): void {
    const instance = snapshot.instances.get(instanceId)
    if (!instance) throw new Error(`Unknown ${role} instance: ${instanceId}`)
    if (!this.isLive(instance)) throw new Error(`Stale ${role} instance: ${instanceId}`)
  }

  private isLive(instance: HubInstance): boolean {
    const ttl = this.options.instanceTtlMs
    if (!ttl) return true
    return this.now().getTime() - new Date(instance.lastSeenAt).getTime() <= ttl
  }

  private purgeExpiredMessages(snapshot: HubMaps): void {
    const maxAgeMs = this.options.messageTtlMs
    if (!maxAgeMs) return
    const cutoff = this.now().getTime() - maxAgeMs
    for (const [id, message] of snapshot.messages) {
      if (message.status === "acknowledged" && new Date(message.createdAt).getTime() < cutoff) {
        snapshot.messages.delete(id)
      }
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  private async loadSnapshot(): Promise<HubMaps> {
    if (this.mutable) return this.mutable
    const snapshot = await this.store.load()
    this.mutable = this.normalizeSnapshot({
      instances: new Map(snapshot.instances.map((instance) => [instance.id, instance])),
      conversations: new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation])),
      messages: new Map(snapshot.messages.map((message) => [message.id, message])),
    })
    return this.mutable
  }

  private async saveSnapshot(snapshot: HubMaps): Promise<void> {
    this.purgeExpiredMessages(snapshot)
    await this.store.save({
      instances: [...snapshot.instances.values()],
      conversations: [...snapshot.conversations.values()],
      messages: [...snapshot.messages.values()],
    })
    this.mutable = snapshot
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private normalizeSnapshot(snapshot: HubMaps): HubMaps {
    return snapshot
  }
}

interface HubMaps {
  instances: Map<string, HubInstance>
  conversations: Map<string, HubConversation>
  messages: Map<string, HubMessage>
}
