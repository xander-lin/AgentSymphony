import { basename } from "node:path"
import { createId } from "../shared/id.ts"
import type { InstanceIdentity, InstanceIdentityStore } from "./identity.ts"

export class MemoryInstanceIdentityStore implements InstanceIdentityStore {
  private readonly identities = new Map<string, InstanceIdentity>()

  constructor(private readonly defaultSeed?: InstanceIdentity) {}

  async load(directory: string, sessionId?: string, seed?: InstanceIdentity): Promise<InstanceIdentity> {
    const key = sessionId ? `session:${sessionId}` : "process"
    const identitySeed = seed ?? this.defaultSeed
    const identity = this.identities.get(key) ?? {
      id: identitySeed?.id ?? createId("inst"),
      name: identitySeed?.name ?? `${basename(directory)}:${sessionId ?? "process"}`,
      directory,
    }
    this.identities.set(key, identity)
    return identity
  }
}
