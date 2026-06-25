import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { renderHubDashboard } from "./dashboard.ts"
import type { AgentSymphonyHub } from "./types.ts"

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export interface HubHttpServerHandle {
  server: Server
  url: string
  close(): Promise<void>
}

export async function listenHubHttpServer(hub: AgentSymphonyHub, port = 4777, hostname = "127.0.0.1"): Promise<HubHttpServerHandle> {
  const server = createServer(async (request, response) => {
    try {
      await route(hub, request, response)
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, hostname, () => resolve())
  })

  const connections = new Set<import("node:net").Socket>()
  server.on("connection", (socket) => {
    connections.add(socket)
    socket.once("close", () => connections.delete(socket))
  })

  const address = server.address() as AddressInfo
  return {
    server,
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      const forceClose = setTimeout(() => {
        for (const socket of connections) socket.destroy()
        connections.clear()
        resolve()
      }, 5000)
      server.close(() => {
        clearTimeout(forceClose)
        resolve()
      })
    }),
  }
}

async function route(hub: AgentSymphonyHub, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost")
  const method = request.method ?? "GET"
  const parts = url.pathname.split("/").filter(Boolean)

  if (method === "GET" && url.pathname === "/") return serveDashboardIndex(response)
  if (method === "GET" && url.pathname.startsWith("/assets/")) return serveDashboardAsset(url.pathname, response)
  if (method === "GET" && url.pathname === "/health") return writeJson(response, 200, { ok: true })
  if (method === "GET" && url.pathname === "/monitor/snapshot") return writeJson(response, 200, await getMonitorSnapshot(hub))
  if (method === "GET" && url.pathname === "/instances") return writeJson(response, 200, await hub.listInstances())
  if (method === "POST" && url.pathname === "/instances") return writeJson(response, 200, await hub.registerInstance(await readJson(request)))
  if (method === "DELETE" && parts[0] === "instances" && parts[1] && parts.length === 2) return writeJson(response, 200, await hub.deleteInstance(parts[1], url.searchParams.get("caller") ?? undefined))
  if (method === "POST" && parts[0] === "instances" && parts[2] === "heartbeat") return writeJson(response, 200, await hub.heartbeat(parts[1] ?? ""))
  if (method === "GET" && parts[0] === "instances" && parts[2] === "inbox") return writeJson(response, 200, await hub.pollMessages(parts[1] ?? ""))
  if (method === "GET" && parts[0] === "instances" && parts[2] === "conversations") return writeJson(response, 200, await hub.listConversationsForInstance(parts[1] ?? ""))
  if (method === "POST" && url.pathname === "/conversations") return writeJson(response, 200, await hub.createConversation(await readJson(request)))
  if (method === "POST" && parts[0] === "threads" && parts[2] === "archive") return writeJson(response, 200, await hub.archiveThread(parts[1] ?? ""))
  if (method === "GET" && parts[0] === "conversations" && parts[2] === "messages") return writeJson(response, 200, await hub.listMessagesForConversation(parts[1] ?? "", Number(url.searchParams.get("limit") ?? "20")))
  if (method === "GET" && parts[0] === "conversations" && parts[1]) return writeJson(response, 200, await hub.getConversation(parts[1]))
  if (method === "POST" && url.pathname === "/messages") return writeJson(response, 200, await hub.sendMessage(await readJson(request)))
  if (method === "POST" && parts[0] === "messages" && parts[2] === "ack") return writeJson(response, 200, await hub.acknowledgeMessage(parts[1] ?? ""))

  writeJson(response, 404, { error: `Unknown route: ${method} ${url.pathname}` })
}

async function readJson(request: IncomingMessage): Promise<any> {
  let raw = ""
  for await (const chunk of request) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(`${JSON.stringify(body)}\n`)
}

function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" })
  response.end(body)
}

async function getMonitorSnapshot(hub: AgentSymphonyHub) {
  if (hub.getMonitorSnapshot) return hub.getMonitorSnapshot()
  return { instances: await hub.listInstances(), conversations: [], messages: [] }
}

async function serveDashboardIndex(response: ServerResponse): Promise<void> {
  const index = await readDashboardFile("index.html", "utf8")
  writeHtml(response, 200, typeof index === "string" ? index : renderHubDashboard())
}

async function serveDashboardAsset(pathname: string, response: ServerResponse): Promise<void> {
  const relative = normalize(pathname.replace(/^\/+/, ""))
  if (relative.startsWith("..")) return writeJson(response, 400, { error: "Invalid asset path" })
  const body = await readDashboardFile(relative)
  if (!body) return writeJson(response, 404, { error: `Unknown asset: ${pathname}` })
  response.writeHead(200, { "content-type": contentType(relative) })
  response.end(body)
}

async function readDashboardFile(relative: string, encoding?: BufferEncoding): Promise<Buffer | string | undefined> {
  for (const root of [packageRoot, process.cwd()]) {
    try {
      return encoding ? readFile(join(root, "dist", "dashboard", relative), encoding) : readFile(join(root, "dist", "dashboard", relative))
    } catch {
      // Try the next root, then fall back to the built-in dashboard.
    }
  }
  return undefined
}

function contentType(pathname: string): string {
  switch (extname(pathname)) {
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    default:
      return "application/octet-stream"
  }
}
