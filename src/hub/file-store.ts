import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { HubStore, HubStoreSnapshot } from "./store.ts"
import { emptyHubStoreSnapshot } from "./store.ts"

export class FileHubStore implements HubStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<HubStoreSnapshot> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      return JSON.parse(raw) as HubStoreSnapshot
    } catch (error) {
      if (isMissingFileError(error)) return emptyHubStoreSnapshot()
      throw error
    }
  }

  async save(snapshot: HubStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
