import type { HubMessage } from "./types.ts"

export interface ReplyContext {
  threadName: string
  createdByThisInstance: boolean
  conversationId: string
  fromInstanceId: string
  messageId: string
  receivedAt: string
}

export interface ReplyContextStore {
  setFromMessage(input: { message: HubMessage; threadName: string; createdByThisInstance: boolean }): Promise<ReplyContext>
  getLatest(): Promise<ReplyContext | undefined>
  getByThread(threadName: string): Promise<ReplyContext | undefined>
  list(): Promise<ReplyContext[]>
}

export class MemoryReplyContextStore implements ReplyContextStore {
  private latest?: ReplyContext
  private readonly byThread = new Map<string, ReplyContext>()

  async setFromMessage(input: { message: HubMessage; threadName: string; createdByThisInstance: boolean }): Promise<ReplyContext> {
    const { message } = input
    this.latest = {
      threadName: input.threadName,
      createdByThisInstance: input.createdByThisInstance,
      conversationId: message.conversationId,
      fromInstanceId: message.fromInstanceId,
      messageId: message.id,
      receivedAt: new Date().toISOString(),
    }
    this.byThread.set(this.latest.threadName, this.latest)
    return this.latest
  }

  async getLatest(): Promise<ReplyContext | undefined> {
    return this.latest
  }

  async getByThread(threadName: string): Promise<ReplyContext | undefined> {
    return this.byThread.get(threadName)
  }

  async list(): Promise<ReplyContext[]> {
    return [...this.byThread.values()].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
  }
}
