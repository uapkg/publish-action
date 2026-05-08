import { basename, dirname, resolve } from 'node:path'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import { ManifestReader } from '@uapkg/package-manifest'
import type { PublishMetadata } from '../contracts/ActionContracts.js'

const MANIFEST_FILE_NAME = 'uapkg.json'

export class PublishMetadataReader {
  constructor(
    private readonly manifestReader = new ManifestReader(),
    private readonly cwdProvider: () => string = () => process.cwd()
  ) {}

  async read(
    manifestPath: string,
    releaseTag: string
  ): Promise<Result<PublishMetadata>> {
    const bag = new DiagnosticBag()

    const absoluteManifestPath = resolve(this.cwdProvider(), manifestPath)
    const manifestFileName = basename(absoluteManifestPath)

    if (manifestFileName !== MANIFEST_FILE_NAME) {
      bag.addError(
        'PUBLISH_ACTION_MANIFEST_NAME_INVALID',
        `Manifest path must reference "${MANIFEST_FILE_NAME}". Received "${manifestPath}".`,
        { manifestPath },
        'Set "manifest-path" to a path ending in "uapkg.json".'
      )
      return bag.toFailure()
    }

    const manifestRoot = dirname(absoluteManifestPath)
    const manifestResult = await this.manifestReader.read(manifestRoot)
    bag.mergeArray(manifestResult.diagnostics)

    if (!manifestResult.ok) {
      return bag.toFailure()
    }

    const packageSource = process.env.GITHUB_REPOSITORY?.trim()
    if (!packageSource) {
      bag.addError(
        'PUBLISH_ACTION_SOURCE_MISSING',
        'Environment variable GITHUB_REPOSITORY is required to resolve package source.',
        {},
        'Run this action within a GitHub repository context.'
      )
      return bag.toFailure()
    }

    return bag.toResult({
      packageName: manifestResult.value.name,
      packageVersion: manifestResult.value.version,
      packageSource,
      releaseTag
    })
  }
}
