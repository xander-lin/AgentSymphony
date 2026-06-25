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
