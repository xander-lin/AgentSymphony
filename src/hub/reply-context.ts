import type { HubMessage } from "./types.ts"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

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

export class FileReplyContextStore implements ReplyContextStore {
  constructor(private readonly filePath: string) {}

  async setFromMessage(input: { message: HubMessage; threadName: string; createdByThisInstance: boolean }): Promise<ReplyContext> {
    const contexts = await this.loadContexts()
    const context: ReplyContext = {
      threadName: input.threadName,
      createdByThisInstance: input.createdByThisInstance,
      conversationId: input.message.conversationId,
      fromInstanceId: input.message.fromInstanceId,
      messageId: input.message.id,
      receivedAt: new Date().toISOString(),
    }
    contexts.set(context.threadName, context)
    await this.saveContexts(contexts)
    return context
  }

  async getLatest(): Promise<ReplyContext | undefined> {
    return this.sortContexts(await this.list())[0]
  }

  async getByThread(threadName: string): Promise<ReplyContext | undefined> {
    return (await this.loadContexts()).get(threadName)
  }

  async list(): Promise<ReplyContext[]> {
    return this.sortContexts([...((await this.loadContexts()).values())])
  }

  private async loadContexts(): Promise<Map<string, ReplyContext>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { contexts?: ReplyContext[] }
      return new Map((parsed.contexts ?? []).map((context) => [context.threadName, context]))
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined
      if (code === "ENOENT") return new Map()
      throw error
    }
  }

  private async saveContexts(contexts: Map<string, ReplyContext>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify({ contexts: [...contexts.values()] }, null, 2)}\n`, "utf8")
  }

  private sortContexts(contexts: ReplyContext[]): ReplyContext[] {
    return contexts.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
  }
}
