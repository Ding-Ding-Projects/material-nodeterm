import { OPEN_WEBUI_IMAGE, OPEN_WEBUI_IMAGE_SOURCE } from './open-webui'

/** Typed catalog entry used by the hosting picker and documentation inventory. */
export interface HostingCatalogEntry {
  id: 'openwebui'
  label: string
  category: 'hosted-service'
  image: typeof OPEN_WEBUI_IMAGE
  imageSource: typeof OPEN_WEBUI_IMAGE_SOURCE
  providers: readonly ['ollama', 'openai-compatible']
  persistentTarget: '/app/backend/data'
  docsPath: 'docs/features/integrations/open-webui-hosting.md'
  availability: 'available'
}

export const HOSTING_CATALOG: readonly HostingCatalogEntry[] = [
  {
    id: 'openwebui',
    label: 'Open WebUI',
    category: 'hosted-service',
    image: OPEN_WEBUI_IMAGE,
    imageSource: OPEN_WEBUI_IMAGE_SOURCE,
    providers: ['ollama', 'openai-compatible'],
    persistentTarget: '/app/backend/data',
    docsPath: 'docs/features/integrations/open-webui-hosting.md',
    availability: 'available'
  }
]

