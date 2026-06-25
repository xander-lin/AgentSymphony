import { join } from "node:path"
import { FileHubStore } from "./file-store.ts"
import { MemoryAgentSymphonyHub } from "./memory.ts"
import { SqliteHubStore } from "./sqlite-store.ts"
import { listenHubHttpServer } from "./http-server.ts"

const port = Number(process.env.AGENTSYMPHONY_HUB_PORT ?? "4777")
const hostname = process.env.AGENTSYMPHONY_HUB_HOST ?? "127.0.0.1"
const instanceTtlMs = Number(process.env.AGENTSYMPHONY_INSTANCE_TTL_MS ?? "3000")
const messageTtlMs = Number(process.env.AGENTSYMPHONY_MESSAGE_TTL_MS ?? "86400000")
const storePath = process.env.AGENTSYMPHONY_HUB_STORE ?? join(process.cwd(), ".agentsymphony", "hub-store.db")
const store = storePath.endsWith(".json") ? new FileHubStore(storePath) : new SqliteHubStore(storePath)
const server = await listenHubHttpServer(new MemoryAgentSymphonyHub({ instanceTtlMs, messageTtlMs }, store), port, hostname)

process.stdout.write(`AgentSymphony hub listening at ${server.url}\nStore: ${storePath} (${store instanceof SqliteHubStore ? "sqlite" : "json"})\n`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
}
