import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ModelCatalogConfig, ModelCatalogEntry, ModelModality } from "./types.ts"

export async function loadModelCatalog(directory: string, env: NodeJS.ProcessEnv = process.env): Promise<ModelCatalogEntry[]> {
  const paths = [
    env.AGENTSYMPHONY_MODEL_CATALOG,
    join(directory, "agentsymphony.models.json"),
    join(homedir(), ".config", "opencode", "agentsymphony", "models.json"),
  ].filter((path): path is string => Boolean(path))

  for (const path of paths) {
    const catalog = await tryLoadCatalog(path)
    if (catalog) return catalog
  }
  return []
}

async function tryLoadCatalog(path: string): Promise<ModelCatalogEntry[] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ModelCatalogConfig | ModelCatalogEntry[]
    const models = Array.isArray(parsed) ? parsed : parsed.models
    return models
      ?.filter((model) => typeof model.id === "string")
      .map((model) => normalizeModelEntry(model)) ?? []
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined
    if (code === "ENOENT") return undefined
    throw error
  }
}

function normalizeModelEntry(model: ModelCatalogEntry): ModelCatalogEntry {
  return {
    ...model,
    modalities: normalizeModalities(model.modalities),
  }
}

function normalizeModalities(modalities: ModelModality[] | undefined): ModelModality[] | undefined {
  if (!modalities || modalities.length === 0) return undefined
  const allowed: ModelModality[] = ["text", "image", "audio", "video"]
  return modalities.filter((modality): modality is ModelModality => allowed.includes(modality))
}
