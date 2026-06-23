import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { renderHubDashboard } from "./dashboard.ts"
import type { AgentSymphonyHub } from "./types.ts"

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

  const address = server.address() as AddressInfo
  return {
    server,
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

async function route(hub: AgentSymphonyHub, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost")
  const method = request.method ?? "GET"
  const parts = url.pathname.split("/").filter(Boolean)

  if (method === "GET" && url.pathname === "/") return writeHtml(response, 200, renderHubDashboard())
  if (method === "GET" && url.pathname === "/health") return writeJson(response, 200, { ok: true })
  if (method === "GET" && url.pathname === "/monitor/snapshot") return writeJson(response, 200, await getMonitorSnapshot(hub))
  if (method === "GET" && url.pathname === "/instances") return writeJson(response, 200, await hub.listInstances())
  if (method === "POST" && url.pathname === "/instances") return writeJson(response, 200, await hub.registerInstance(await readJson(request)))
  if (method === "POST" && parts[0] === "instances" && parts[2] === "heartbeat") return writeJson(response, 200, await hub.heartbeat(parts[1] ?? ""))
  if (method === "GET" && parts[0] === "instances" && parts[2] === "inbox") return writeJson(response, 200, await hub.pollMessages(parts[1] ?? ""))
  if (method === "GET" && parts[0] === "instances" && parts[2] === "conversations") return writeJson(response, 200, await hub.listConversationsForInstance(parts[1] ?? ""))
  if (method === "POST" && url.pathname === "/conversations") return writeJson(response, 200, await hub.createConversation(await readJson(request)))
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
