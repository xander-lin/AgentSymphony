import type { HubStore, HubStoreSnapshot } from "./store.ts"
import { emptyHubStoreSnapshot } from "./store.ts"

export class MemoryHubStore implements HubStore {
  private snapshot = emptyHubStoreSnapshot()

  async load(): Promise<HubStoreSnapshot> {
    return cloneSnapshot(this.snapshot)
  }

  async save(snapshot: HubStoreSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot)
  }
}

function cloneSnapshot(snapshot: HubStoreSnapshot): HubStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HubStoreSnapshot
}
