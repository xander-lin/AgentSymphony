import { basename } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createId } from "../shared/id.ts"

export interface InstanceIdentity {
  id: string
  name: string
  directory: string
}

export interface InstanceIdentityStore {
  load(directory: string, sessionId?: string, seed?: InstanceIdentity): Promise<InstanceIdentity>
}

export class FileInstanceIdentityStore implements InstanceIdentityStore {
  private identities = new Map<string, InstanceIdentity>()

  async load(directory: string, sessionId?: string, seed?: InstanceIdentity): Promise<InstanceIdentity> {
    const key = sessionId ? `session:${sessionId}` : "process"
    const identity = this.identities.get(key) ?? await this.loadIdentity(directory, sessionId, seed)
    this.identities.set(key, identity)
    return identity
  }

  private async loadIdentity(directory: string, sessionId?: string, seed?: InstanceIdentity): Promise<InstanceIdentity> {
    const explicitId = process.env.AGENTSYMPHONY_INSTANCE_ID
    const explicitName = process.env.AGENTSYMPHONY_INSTANCE_NAME
    if (explicitId) return { id: explicitId, name: explicitName ?? `${basename(directory)}:${process.pid}`, directory }
    if (!sessionId) return { id: createId("inst"), name: explicitName ?? `${basename(directory)}:${process.pid}`, directory }

    const stateDirectory = join(directory, ".agentsymphony")
    const identitiesDirectory = join(stateDirectory, "instances")
    const identityFile = join(identitiesDirectory, `session-${this.safeSessionId(sessionId)}.json`)
    const existing = await this.tryRead(identityFile)
    const identity = {
      id: existing?.id ?? seed?.id ?? createId("inst"),
      name: explicitName ?? existing?.name ?? seed?.name ?? `${basename(directory)}:${sessionId}`,
      directory,
    }
    await mkdir(identitiesDirectory, { recursive: true })
    await writeFile(identityFile, `${JSON.stringify(identity, null, 2)}\n`, "utf8")
    return identity
  }

  private safeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96)
  }

  private async tryRead(filePath: string): Promise<Pick<InstanceIdentity, "id" | "name"> | undefined> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<InstanceIdentity>
      if (typeof parsed.id === "string" && typeof parsed.name === "string") return { id: parsed.id, name: parsed.name }
      if (typeof parsed.id === "string") return { id: parsed.id, name: basename(process.cwd()) }
      return undefined
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined
      if (code === "ENOENT") return undefined
      throw error
    }
  }
}
