import { dirname, posix, resolve } from 'node:path'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import { ManifestReader } from '@uapkg/package-manifest'
import type { PublishManifestMetadata } from '../contracts/ActionContracts.js'

const MANIFEST_FILE_NAME = 'uapkg.json'
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export class PublishMetadataReader {
  constructor(
    private readonly manifestReader = new ManifestReader(),
    private readonly workspaceProvider: () => string = () => process.env.GITHUB_WORKSPACE?.trim() || process.cwd(),
  ) {}

  async read(manifestPath: string): Promise<Result<PublishManifestMetadata>> {
    const bag = new DiagnosticBag()
    const normalizedManifestPath = this.normalizeManifestPath(manifestPath)

    if (!normalizedManifestPath) {
      bag.addError(
        'PUBLISH_ACTION_MANIFEST_PATH_INVALID',
        `Manifest path must be a repository-relative path ending in "${MANIFEST_FILE_NAME}".`,
        { manifestPath },
        'Use a path such as "uapkg.json" or "packages/example/uapkg.json".',
      )
      return bag.toFailure()
    }

    const workspace = resolve(this.workspaceProvider())
    const absoluteManifestPath = resolve(workspace, ...normalizedManifestPath.split('/'))
    const manifestRoot = dirname(absoluteManifestPath)
    const manifestResult = await this.manifestReader.read(manifestRoot)
    bag.mergeArray(manifestResult.diagnostics)

    if (!manifestResult.ok) {
      return bag.toFailure()
    }

    const packageSource = process.env.GITHUB_REPOSITORY?.trim()
    if (!packageSource || !REPOSITORY_PATTERN.test(packageSource)) {
      bag.addError(
        'PUBLISH_ACTION_SOURCE_INVALID',
        'GITHUB_REPOSITORY must identify the current repository in owner/name form.',
        {},
        'Run this action in a GitHub Actions repository workflow.',
      )
      return bag.toFailure()
    }

    return bag.toResult({
      packageName: manifestResult.value.name,
      packageVersion: manifestResult.value.version,
      packageSource,
      manifestPath: normalizedManifestPath,
    })
  }

  private normalizeManifestPath(manifestPath: string): string | undefined {
    const value = manifestPath.trim()
    if (
      value.length === 0 ||
      value.length > 1024 ||
      value.includes('\\') ||
      value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) ||
      value.split('/').some((part) => part === '..')
    ) {
      return undefined
    }

    const normalized = posix.normalize(value)
    if (normalized === '..' || normalized.startsWith('../') || posix.basename(normalized) !== MANIFEST_FILE_NAME) {
      return undefined
    }

    return normalized
  }
}
