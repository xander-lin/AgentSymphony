import type { HubConversation, HubInstance, HubMessage } from "./types.ts"

export interface HubStoreSnapshot {
  instances: HubInstance[]
  conversations: HubConversation[]
  messages: HubMessage[]
}

export interface HubStore {
  load(): Promise<HubStoreSnapshot>
  save(snapshot: HubStoreSnapshot): Promise<void>
}

export function emptyHubStoreSnapshot(): HubStoreSnapshot {
  return { instances: [], conversations: [], messages: [] }
}
