import type { HubMessage } from "./types.ts"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export interface ReplyContext {
  threadName: string
  createdByThisInstance: boolean
  conversationId: string
  fromInstanceId: string
  toInstanceId: string
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
      toInstanceId: "",
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

const SAFE_ID_MAX_LENGTH = 64

export class FileReplyContextStore implements ReplyContextStore {
  private cache?: Map<string, ReplyContext>

  constructor(
    private readonly directory: string,
    private readonly getInstanceId: () => string | undefined,
  ) {}

  private get filePath(): string {
    const instanceId = this.getInstanceId()
    if (!instanceId) throw new Error("Instance identity unavailable for reply-context persistence")
    const safeId = instanceId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, SAFE_ID_MAX_LENGTH)
    return join(this.directory, ".agentsymphony", `reply-context-${safeId}.json`)
  }

  async setFromMessage(input: { message: HubMessage; threadName: string; createdByThisInstance: boolean }): Promise<ReplyContext> {
    const instanceId = this.getInstanceId()
    if (!instanceId) throw new Error("Instance identity unavailable for reply-context persistence")
    const contexts = this.cache ?? await this.loadContexts()
    const context: ReplyContext = {
      threadName: input.threadName,
      createdByThisInstance: input.createdByThisInstance,
      conversationId: input.message.conversationId,
      fromInstanceId: input.message.fromInstanceId,
      toInstanceId: instanceId,
      messageId: input.message.id,
      receivedAt: new Date().toISOString(),
    }
    contexts.set(context.threadName, context)
    this.cache = contexts
    await this.saveContexts(contexts)
    return context
  }

  async getLatest(): Promise<ReplyContext | undefined> {
    const contexts = this.cache ?? await this.loadContexts()
    return this.sortContexts([...contexts.values()])[0]
  }

  async getByThread(threadName: string): Promise<ReplyContext | undefined> {
    const contexts = this.cache ?? await this.loadContexts()
    return contexts.get(threadName)
  }

  async list(): Promise<ReplyContext[]> {
    const contexts = this.cache ?? await this.loadContexts()
    return this.sortContexts([...contexts.values()])
  }

  private async loadContexts(): Promise<Map<string, ReplyContext>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { contexts?: ReplyContext[] }
      this.cache = new Map((parsed.contexts ?? []).map((context) => [context.threadName, context]))
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined
      if (code === "ENOENT") this.cache = new Map()
      else throw error
    }
    return this.cache
  }

  private async saveContexts(contexts: Map<string, ReplyContext>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify({ contexts: [...contexts.values()] }, null, 2)}\n`, "utf8")
  }

  private sortContexts(contexts: ReplyContext[]): ReplyContext[] {
    return contexts.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
  }
}
