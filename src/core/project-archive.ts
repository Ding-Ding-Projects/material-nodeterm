import { rm } from 'node:fs/promises'
import type { Project } from '../shared/types'
import { freshProjectId } from '../shared/project-id'
import { fileToProject, projectToFile, serializeProjectFile, type ProjectFileV1 } from './workspace-files'
import { LocalHistoryStore } from './local-history'

const MAX_ARCHIVE_BYTES = 180 * 1024 * 1024

interface ProjectArchiveV1 {
  schemaVersion: 1
  exportedAt: string
  project: ProjectFileV1
  history: { format: 'git-bundle-base64'; bytes: string }
}

function isProjectFile(value: unknown): value is ProjectFileV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const file = value as Partial<ProjectFileV1>
  return file.version === 1 && typeof file.name === 'string' && Array.isArray(file.nodes)
}

export class ProjectArchiveService {
  constructor(private readonly history: LocalHistoryStore) {}

  async export(project: Project): Promise<string> {
    const exportedAt = new Date().toISOString()
    const snapshot = projectToFile(project, 0, exportedAt)
    await this.history.record({
      domain: `project_${project.id}`,
      filename: 'project.json',
      content: serializeProjectFile(snapshot),
      label: `Exported project ${project.name}`,
      action: 'updated'
    })
    const bundle = await this.history.exportBundle(`project_${project.id}`)
    if (!bundle) throw new Error('The project history repository could not be bundled.')
    const archive: ProjectArchiveV1 = {
      schemaVersion: 1,
      exportedAt,
      project: snapshot,
      history: { format: 'git-bundle-base64', bytes: bundle.toString('base64') }
    }
    const text = JSON.stringify(archive)
    if (Buffer.byteLength(text, 'utf-8') > MAX_ARCHIVE_BYTES) {
      throw new Error('The project archive exceeds the 180 MB limit.')
    }
    return text
  }

  async import(text: string): Promise<Project> {
    if (Buffer.byteLength(text, 'utf-8') > MAX_ARCHIVE_BYTES) {
      throw new Error('The project archive exceeds the 180 MB limit.')
    }
    const parsed = JSON.parse(text) as Partial<ProjectArchiveV1>
    const keys = Object.keys(parsed).sort().join(',')
    if (keys !== 'exportedAt,history,project,schemaVersion' || parsed.schemaVersion !== 1) {
      throw new Error('This is not a supported nodeterm project archive.')
    }
    if (!isProjectFile(parsed.project)) throw new Error('The project snapshot is invalid.')
    if (parsed.history?.format !== 'git-bundle-base64' || typeof parsed.history.bytes !== 'string') {
      throw new Error('The project history bundle is missing.')
    }
    const bundle = Buffer.from(parsed.history.bytes, 'base64')
    if (bundle.toString('base64') !== parsed.history.bytes) throw new Error('The project history bundle is malformed.')
    const id = freshProjectId()
    const domain = `project_${id}`
    try {
      await this.history.importBundle(domain, bundle)
      const head = await this.history.readHeadFile(domain, 'project.json')
      if (head?.trimEnd() !== serializeProjectFile(parsed.project).trimEnd()) {
        throw new Error('The project snapshot does not match the bundled history tip.')
      }
      return fileToProject(parsed.project, { id })
    } catch (error) {
      // importBundle only publishes a fresh domain; remove it when the archive fails its final
      // snapshot/history consistency proof so a retry cannot inherit partial state.
      await rm(this.historyPathForCleanup(domain), { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private historyPathForCleanup(domain: string): string {
    return this.history.domainPath(domain)
  }
}
