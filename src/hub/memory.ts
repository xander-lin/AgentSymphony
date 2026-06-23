import { createId } from "../shared/id.ts"
import { MemoryHubStore } from "./memory-store.ts"
import type { HubStore } from "./store.ts"
import type {
  AgentSymphonyHub,
  CreateHubConversationInput,
  HubConversation,
  HubInstance,
  HubMessage,
  RegisterInstanceInput,
  SendHubMessageInput,
} from "./types.ts"

export class MemoryAgentSymphonyHub implements AgentSymphonyHub {
  private writeQueue = Promise.resolve()

  constructor(
    private readonly options: { instanceTtlMs?: number; now?: () => Date } = {},
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
      const existing = this.findConversationBetween(snapshot, input.parentInstanceId, input.targetInstanceId)
      if (existing) return existing

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
      const queued = [...snapshot.messages.values()].filter((message) => message.toInstanceId === instanceId && message.status === "queued")
      for (const message of queued) {
        snapshot.messages.set(message.id, { ...message, status: "delivered" })
      }
      await this.saveSnapshot(snapshot)
      return queued.map((message) => ({ ...message, status: "delivered" }))
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

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  private async loadSnapshot(): Promise<HubMaps> {
    const snapshot = await this.store.load()
    return this.normalizeSnapshot({
      instances: new Map(snapshot.instances.map((instance) => [instance.id, instance])),
      conversations: new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation])),
      messages: new Map(snapshot.messages.map((message) => [message.id, message])),
    })
  }

  private async saveSnapshot(snapshot: HubMaps): Promise<void> {
    await this.store.save({
      instances: [...snapshot.instances.values()],
      conversations: [...snapshot.conversations.values()],
      messages: [...snapshot.messages.values()],
    })
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private findConversationBetween(snapshot: HubMaps, leftInstanceId: string, rightInstanceId: string): HubConversation | undefined {
    const pairKey = this.conversationPairKey(leftInstanceId, rightInstanceId)
    return [...snapshot.conversations.values()].find((conversation) => this.conversationPairKey(conversation.parentInstanceId, conversation.targetInstanceId) === pairKey)
  }

  private normalizeSnapshot(snapshot: HubMaps): HubMaps {
    const conversationsByPair = new Map<string, HubConversation>()
    const canonicalConversationIds = new Map<string, string>()
    for (const conversation of [...snapshot.conversations.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
      const pairKey = this.conversationPairKey(conversation.parentInstanceId, conversation.targetInstanceId)
      const canonical = conversationsByPair.get(pairKey)
      if (canonical) {
        canonicalConversationIds.set(conversation.id, canonical.id)
        continue
      }
      conversationsByPair.set(pairKey, conversation)
      canonicalConversationIds.set(conversation.id, conversation.id)
    }

    const messages = new Map<string, HubMessage>()
    for (const message of snapshot.messages.values()) {
      const conversationId = canonicalConversationIds.get(message.conversationId)
      if (!conversationId) continue
      messages.set(message.id, { ...message, conversationId })
    }

    return {
      instances: snapshot.instances,
      conversations: new Map([...conversationsByPair.values()].map((conversation) => [conversation.id, conversation])),
      messages,
    }
  }

  private conversationPairKey(leftInstanceId: string, rightInstanceId: string): string {
    return [leftInstanceId, rightInstanceId].sort().join(":")
  }
}

interface HubMaps {
  instances: Map<string, HubInstance>
  conversations: Map<string, HubConversation>
  messages: Map<string, HubMessage>
}
