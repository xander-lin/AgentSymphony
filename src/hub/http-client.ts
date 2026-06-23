import type {
  AgentSymphonyHub,
  CreateHubConversationInput,
  HubConversation,
  HubInstance,
  HubMessage,
  RegisterInstanceInput,
  SendHubMessageInput,
} from "./types.ts"

export class HttpAgentSymphonyHubClient implements AgentSymphonyHub {
  constructor(private readonly baseUrl = process.env.AGENTSYMPHONY_HUB_URL ?? "http://127.0.0.1:4777") {}

  registerInstance(input: RegisterInstanceInput): Promise<HubInstance> {
    return this.request("/instances", { method: "POST", body: input })
  }

  heartbeat(instanceId: string): Promise<HubInstance> {
    return this.request(`/instances/${encodeURIComponent(instanceId)}/heartbeat`, { method: "POST" })
  }

  listInstances(): Promise<HubInstance[]> {
    return this.request("/instances")
  }

  createConversation(input: CreateHubConversationInput): Promise<HubConversation> {
    return this.request("/conversations", { method: "POST", body: input })
  }

  getConversation(conversationId: string): Promise<HubConversation | undefined> {
    return this.request(`/conversations/${encodeURIComponent(conversationId)}`)
  }

  listConversationsForInstance(instanceId: string): Promise<HubConversation[]> {
    return this.request(`/instances/${encodeURIComponent(instanceId)}/conversations`)
  }

  sendMessage(input: SendHubMessageInput): Promise<HubMessage> {
    return this.request("/messages", { method: "POST", body: input })
  }

  listMessagesForConversation(conversationId: string, limit?: number): Promise<HubMessage[]> {
    const query = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`
    return this.request(`/conversations/${encodeURIComponent(conversationId)}/messages${query}`)
  }

  pollMessages(instanceId: string): Promise<HubMessage[]> {
    return this.request(`/instances/${encodeURIComponent(instanceId)}/inbox`)
  }

  acknowledgeMessage(messageId: string): Promise<HubMessage | undefined> {
    return this.request(`/messages/${encodeURIComponent(messageId)}/ack`, { method: "POST" })
  }

  getMonitorSnapshot(): Promise<{ instances: HubInstance[]; conversations: HubConversation[]; messages: HubMessage[] }> {
    return this.request("/monitor/snapshot")
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `AgentSymphony hub request failed: ${response.status}`)
    return body as T
  }
}
