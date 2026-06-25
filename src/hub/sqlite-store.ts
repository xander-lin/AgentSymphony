import { spawn } from "node:child_process"
import type { HubStore, HubStoreSnapshot } from "./store.ts"
import type { HubConversation, HubInstance, HubMessage } from "./types.ts"

class SqliteProcess {
  private constructor(private db: string) {}

  static async open(databasePath: string): Promise<SqliteProcess> {
    const proc = new SqliteProcess(databasePath)
    await proc.ensureSchema()
    return proc
  }

  private async ensureSchema(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        directory TEXT NOT NULL,
        tuiBaseUrl TEXT,
        registeredAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        threadName TEXT NOT NULL,
        createdByInstanceId TEXT NOT NULL,
        parentInstanceId TEXT NOT NULL,
        targetInstanceId TEXT NOT NULL,
        title TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        fromInstanceId TEXT NOT NULL,
        toInstanceId TEXT NOT NULL,
        content TEXT NOT NULL,
        variant TEXT,
        createdAt TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `)
  }

  async query<T>(sql: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const child = spawn("sqlite3", ["-json", this.db, sql], { stdio: ["ignore", "pipe", "pipe"] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`sqlite3 error: ${Buffer.concat(stderr).toString("utf8")}`))
        const raw = Buffer.concat(stdout).toString("utf8").trim()
        resolve(raw ? JSON.parse(raw) as T[] : [])
      })
    })
  }

  async run(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("sqlite3", [this.db], { stdio: ["pipe", "pipe", "pipe"] })
      const stderr: Buffer[] = []
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`sqlite3 error: ${Buffer.concat(stderr).toString("utf8")}`))
        resolve()
      })
      child.stdin.write(sql)
      child.stdin.end()
    })
  }
}

export class SqliteHubStore implements HubStore {
  private proc?: SqliteProcess

  constructor(private readonly databasePath: string) {}

  private async process(): Promise<SqliteProcess> {
    if (!this.proc) this.proc = await SqliteProcess.open(this.databasePath)
    return this.proc
  }

  async load(): Promise<HubStoreSnapshot> {
    const proc = await this.process()
    return {
      instances: await proc.query<HubInstance>("SELECT id, name, directory, tuiBaseUrl, registeredAt, lastSeenAt FROM instances"),
      conversations: await proc.query<HubConversation>("SELECT id, threadName, createdByInstanceId, parentInstanceId, targetInstanceId, title, createdAt, updatedAt FROM conversations"),
      messages: await proc.query<HubMessage>("SELECT id, conversationId, fromInstanceId, toInstanceId, content, variant, createdAt, status FROM messages"),
    }
  }

  async save(snapshot: HubStoreSnapshot): Promise<void> {
    const proc = await this.process()
    const lines: string[] = ["BEGIN;"]
    lines.push("DELETE FROM messages;", "DELETE FROM conversations;", "DELETE FROM instances;")
    lines.push(...this.encodeInstances(snapshot.instances))
    lines.push(...this.encodeConversations(snapshot.conversations))
    lines.push(...this.encodeMessages(snapshot.messages))
    lines.push("COMMIT;")
    await proc.run(lines.join("\n"))
  }

  private encodeInstances(instances: HubInstance[]): string[] {
    return instances.map((i) =>
      `INSERT INTO instances (id, name, directory, tuiBaseUrl, registeredAt, lastSeenAt) VALUES (${sqlEscape(i.id)},${sqlEscape(i.name)},${sqlEscape(i.directory)},${sqlEscapeOrNull(i.tuiBaseUrl)},${sqlEscape(i.registeredAt)},${sqlEscape(i.lastSeenAt)});`
    )
  }

  private encodeConversations(conversations: HubConversation[]): string[] {
    return conversations.map((c) =>
      `INSERT INTO conversations (id, threadName, createdByInstanceId, parentInstanceId, targetInstanceId, title, createdAt, updatedAt) VALUES (${sqlEscape(c.id)},${sqlEscape(c.threadName)},${sqlEscape(c.createdByInstanceId)},${sqlEscape(c.parentInstanceId)},${sqlEscape(c.targetInstanceId)},${sqlEscape(c.title)},${sqlEscape(c.createdAt)},${sqlEscape(c.updatedAt)});`
    )
  }

  private encodeMessages(messages: HubMessage[]): string[] {
    return messages.map((m) =>
      `INSERT INTO messages (id, conversationId, fromInstanceId, toInstanceId, content, variant, createdAt, status) VALUES (${sqlEscape(m.id)},${sqlEscape(m.conversationId)},${sqlEscape(m.fromInstanceId)},${sqlEscape(m.toInstanceId)},${sqlEscape(m.content)},${sqlEscapeOrNull(m.variant)},${sqlEscape(m.createdAt)},${sqlEscape(m.status)});`
    )
  }
}

function sqlEscape(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlEscapeOrNull(value: string | undefined | null): string {
  if (value === undefined || value === null) return "NULL"
  return sqlEscape(value)
}
