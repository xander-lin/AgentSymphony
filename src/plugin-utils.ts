import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentSymphonyHub, DeleteHubInstanceResult, HubConversation, HubMessage } from "./hub/types.ts"
import type { InstanceIdentity } from "./instance/identity.ts"

export async function respondHub(input: {
  ok?: boolean
  hub: AgentSymphonyHub
  directory: string
  identity: InstanceIdentity | undefined
  type: string
  summary: string
  data: unknown
}): Promise<string> {
  const warnings = input.hub.getMonitorSnapshot ? await offlineReceiverWarnings(input.hub as { getMonitorSnapshot: NonNullable<AgentSymphonyHub["getMonitorSnapshot"]> }, input.directory, input.identity) : []
  return JSON.stringify({
    ok: input.ok ?? true,
    type: input.type,
    summary: input.summary,
    data: input.data,
    ...(warnings.length > 0 ? { warnings } : {}),
  }, null, 2)
}

export async function offlineReceiverWarnings(hub: { getMonitorSnapshot: NonNullable<AgentSymphonyHub["getMonitorSnapshot"]> }, directory: string, identity: InstanceIdentity | undefined): Promise<unknown[]> {
  if (!identity) return []
  const snapshot = await hub.getMonitorSnapshot()
  const liveInstanceIds = new Set(snapshot.instances.filter((instance) => instance.online !== false).map((instance) => instance.id))
  const instancesById = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
  const offlineThreads = snapshot.conversations
    .filter((conversation) => conversation.parentInstanceId === identity.id || conversation.targetInstanceId === identity.id)
    .map((conversation) => {
      const targetInstanceId = conversation.parentInstanceId === identity.id ? conversation.targetInstanceId : conversation.parentInstanceId
      return { conversation, targetInstanceId, target: instancesById.get(targetInstanceId) }
    })
    .filter((item) => item.target && !liveInstanceIds.has(item.targetInstanceId))

  if (offlineThreads.length === 0) return []
  return [{
    type: "hub.offline_receivers",
    summary: "Some receiver instances connected to this node are offline. Decide whether each receiver is stale and should be deleted, or still needed and should be resumed.",
    decisionRequired: true,
    question: "Are these offline receivers outdated and safe to delete, or should they be resumed?",
    offlineReceivers: await Promise.all(offlineThreads.map(async ({ conversation, targetInstanceId, target }) => ({
      threadName: conversation.threadName,
      title: conversation.title,
      conversationId: conversation.id,
      targetInstanceId,
      targetName: target?.name,
      lastSeenAt: target?.lastSeenAt,
      choices: {
        resume: { tool: "agentsymphony_hub_resume_receiver", sessionId: await findSessionIdForInstance(directory, targetInstanceId) },
        delete: { tool: "agentsymphony_hub_delete_teammate", targetInstanceId, note: "Ask the user before deleting a stale offline teammate. Related threads and messages are removed automatically." },
      },
    }))),
  }]
}

export async function sendHubMessageOrOfflineNotice(input: {
  hub: AgentSymphonyHub
  directory: string
  conversationId: string
  fromInstanceId: string
  content: string
  variant?: string
}): Promise<{ ok: true; message: HubMessage } | { ok: false; summary: string; data: unknown }> {
  if (!input.content.trim()) throw new Error("Message content cannot be empty")
  const conversation = await input.hub.getConversation(input.conversationId)
  if (!conversation) throw new Error(`Unknown hub conversation: ${input.conversationId}`)
  const targetInstanceId = input.fromInstanceId === conversation.parentInstanceId ? conversation.targetInstanceId : conversation.parentInstanceId
  const liveInstances = await input.hub.listInstances()
  if (!liveInstances.some((instance) => instance.id === targetInstanceId)) {
    const sessionId = await findSessionIdForInstance(input.directory, targetInstanceId)
    return {
      ok: false,
      summary: `Target instance ${targetInstanceId} is offline. Resume it before sending this message.`,
      data: {
        conversation: describeConversation(conversation),
        targetInstanceId,
        resume: sessionId ? { tool: "agentsymphony_hub_resume_receiver", sessionId } : { tool: "agentsymphony_hub_resume_receiver", sessionId: undefined },
        unsentMessage: input.content,
        unsentVariant: input.variant,
      },
    }
  }
  return { ok: true, message: await input.hub.sendMessage({ conversationId: input.conversationId, fromInstanceId: input.fromInstanceId, content: input.content, variant: input.variant }) }
}

export async function sendInitialHubMessage(input: {
  hub: Pick<AgentSymphonyHub, "listInstances" | "sendMessage">
  fromInstanceId: string
  conversation: HubConversation
  content?: string
  variant?: string
}): Promise<HubMessage | undefined> {
  if (!input.content?.trim()) return undefined
  const targetInstanceId = input.fromInstanceId === input.conversation.parentInstanceId ? input.conversation.targetInstanceId : input.conversation.parentInstanceId
  const liveInstances = await input.hub.listInstances()
  if (!liveInstances.some((instance) => instance.id === targetInstanceId)) throw new Error(`Target instance ${targetInstanceId} is offline. Resume it before sending this message.`)
  return input.hub.sendMessage({ conversationId: input.conversation.id, fromInstanceId: input.fromInstanceId, content: input.content, variant: input.variant })
}

export async function findVisibleConversationByThread(hub: Pick<AgentSymphonyHub, "listConversationsForInstance">, instanceId: string, threadName: string): Promise<HubConversation | undefined> {
  const conversations = await hub.listConversationsForInstance(instanceId)
  return conversations.find((candidate) => candidate.threadName === threadName)
}

export async function deleteVisibleTeammate(hub: Pick<AgentSymphonyHub, "listConversationsForInstance" | "deleteInstance">, instanceId: string, targetInstanceId: string): Promise<DeleteHubInstanceResult> {
  const teammate = await findVisibleTeammateByInstanceId(hub, instanceId, targetInstanceId)
  if (!teammate) throw new Error(`Cannot delete teammate outside this session's visible teammate set: ${targetInstanceId}`)
  return hub.deleteInstance(targetInstanceId)
}

export async function findVisibleTeammateByInstanceId(hub: Pick<AgentSymphonyHub, "listConversationsForInstance">, instanceId: string, targetInstanceId: string): Promise<HubConversation | undefined> {
  if (instanceId === targetInstanceId) return undefined
  const conversations = await hub.listConversationsForInstance(instanceId)
  return conversations.find((conversation) => conversation.parentInstanceId === targetInstanceId || conversation.targetInstanceId === targetInstanceId)
}

export function describeConversation(conversation: HubConversation): Pick<HubConversation, "id" | "threadName" | "title" | "parentInstanceId" | "targetInstanceId"> {
  return {
    id: conversation.id,
    threadName: conversation.threadName,
    title: conversation.title,
    parentInstanceId: conversation.parentInstanceId,
    targetInstanceId: conversation.targetInstanceId,
  }
}

export function defaultThreadName(value: string): string {
  return `receiver-${value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(-12)}`
}

const sessionIdCache = new Map<string, string>()

export async function findSessionIdForInstance(directory: string, instanceId: string): Promise<string | undefined> {
  const cacheKey = `${directory}:${instanceId}`
  const cached = sessionIdCache.get(cacheKey)
  if (cached !== undefined) return cached || undefined
  const instancesDirectory = join(directory, ".agentsymphony", "instances")
  try {
    const entries = await readdir(instancesDirectory)
    for (const entry of entries) {
      if (!entry.startsWith("session-") || !entry.endsWith(".json")) continue
      const parsed = JSON.parse(await readFile(join(instancesDirectory, entry), "utf8")) as Partial<InstanceIdentity>
      if (parsed.id === instanceId) {
        const sessionId = entry.slice("session-".length, -".json".length)
        sessionIdCache.set(cacheKey, sessionId)
        return sessionId
      }
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined
    if (code !== "ENOENT") throw error
  }
  sessionIdCache.set(cacheKey, "")
  return undefined
}
