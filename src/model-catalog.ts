import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type ModelModality = "text" | "image" | "audio" | "video"

export interface ModelCatalogEntry {
  id: string
  label?: string
  modalities?: ModelModality[]
  strengths?: string[]
  bestFor?: string[]
  avoidFor?: string[]
  notes?: string
}

export interface ModelCatalogConfig {
  models?: ModelCatalogEntry[]
}

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

export function formatModelCatalogGuidance(models: ModelCatalogEntry[]): string {
  const header = "Model selection: do not rely on static built-in knowledge of model names or freshness. Model availability and capability changes quickly; prefer the configured model catalog below and the user's current opencode config. Launch may set model for a new teammate; later sends/replies may set variant only."
  if (models.length === 0) return `${header}\nConfigured model catalog: none found. If model choice matters, ask the user or choose conservatively based on the task instead of assuming a specific model's capabilities.`

  const entries = models.map((model) => {
    const lines = [`- ${model.id}${model.label ? ` (${model.label})` : ""}`]
    if (model.modalities?.length) lines.push(`  modalities: ${model.modalities.join(", ")}`)
    if (model.strengths?.length) lines.push(`  strengths: ${model.strengths.join(", ")}`)
    if (model.bestFor?.length) lines.push(`  best for: ${model.bestFor.join(", ")}`)
    if (model.avoidFor?.length) lines.push(`  avoid for: ${model.avoidFor.join(", ")}`)
    if (model.notes) lines.push(`  notes: ${model.notes}`)
    return lines.join("\n")
  })
  return `${header}\nConfigured model catalog:\n${entries.join("\n")}`
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
