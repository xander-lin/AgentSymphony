import { basename } from "node:path"
import { createId } from "../shared/id.ts"

export interface InstanceIdentity {
  id: string
  name: string
  directory: string
}

export interface InstanceIdentityStore {
  load(directory: string): Promise<InstanceIdentity>
}

export class FileInstanceIdentityStore implements InstanceIdentityStore {
  private identity?: InstanceIdentity

  async load(directory: string): Promise<InstanceIdentity> {
    this.identity ??= {
      id: process.env.AGENTSYMPHONY_INSTANCE_ID ?? createId("inst"),
      name: process.env.AGENTSYMPHONY_INSTANCE_NAME ?? `${basename(directory)}:${process.pid}`,
      directory,
    }
    return this.identity
  }
}
