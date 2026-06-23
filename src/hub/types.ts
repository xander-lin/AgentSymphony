export interface HubInstance {
  id: string
  name: string
  directory: string
  tuiBaseUrl?: string
  registeredAt: string
  lastSeenAt: string
  online?: boolean
}

export interface HubConversation {
  id: string
  threadName: string
  createdByInstanceId: string
  parentInstanceId: string
  targetInstanceId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type HubMessageStatus = "queued" | "delivered" | "acknowledged"

export interface HubMessage {
  id: string
  conversationId: string
  fromInstanceId: string
  toInstanceId: string
  content: string
  createdAt: string
  status: HubMessageStatus
}

export interface RegisterInstanceInput {
  id?: string
  name: string
  directory: string
  tuiBaseUrl?: string
}

export interface CreateHubConversationInput {
  id?: string
  parentInstanceId: string
  targetInstanceId: string
  title: string
  threadName?: string
}

export interface SendHubMessageInput {
  conversationId: string
  fromInstanceId: string
  content: string
}

export interface AgentSymphonyHub {
  registerInstance(input: RegisterInstanceInput): Promise<HubInstance>
  heartbeat(instanceId: string): Promise<HubInstance>
  listInstances(): Promise<HubInstance[]>
  createConversation(input: CreateHubConversationInput): Promise<HubConversation>
  getConversation(conversationId: string): Promise<HubConversation | undefined>
  listConversationsForInstance(instanceId: string): Promise<HubConversation[]>
  sendMessage(input: SendHubMessageInput): Promise<HubMessage>
  listMessagesForConversation(conversationId: string, limit?: number): Promise<HubMessage[]>
  pollMessages(instanceId: string): Promise<HubMessage[]>
  acknowledgeMessage(messageId: string): Promise<HubMessage | undefined>
  getMonitorSnapshot?(): Promise<{ instances: HubInstance[]; conversations: HubConversation[]; messages: HubMessage[] }>
}
