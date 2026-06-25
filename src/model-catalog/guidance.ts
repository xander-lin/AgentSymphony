import type { ModelCatalogEntry } from "./types.ts"

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

export class MockModelCatalog {
  constructor(private models: ModelCatalogEntry[] = []) {}

  load(): Promise<ModelCatalogEntry[]> {
    return Promise.resolve([...this.models])
  }

  formatGuidance(): string {
    return formatModelCatalogGuidance(this.models)
  }
}
