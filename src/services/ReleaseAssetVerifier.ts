import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type { ReleaseAssetVerificationRequest } from '../contracts/ActionContracts.js'
import type { GitHubApi } from '../contracts/GitHubContracts.js'
import type { ActionLogger } from './ActionLogger.js'
import type { GitHubApiExecutor } from './GitHubApiExecutor.js'

export class ReleaseAssetVerifier {
  constructor(
    private readonly api: GitHubApi,
    private readonly apiExecutor: GitHubApiExecutor,
    private readonly logger: ActionLogger,
  ) {}

  async verify(request: ReleaseAssetVerificationRequest): Promise<Result<string>> {
    const bag = new DiagnosticBag()

    const releaseResult = await this.apiExecutor.execute(`get release by tag ${request.releaseTag}`, () =>
      this.api.rest.repos.getReleaseByTag({
        owner: request.packageSource.owner,
        repo: request.packageSource.name,
        tag: request.releaseTag,
      }),
    )

    bag.mergeArray(releaseResult.diagnostics)
    if (!releaseResult.ok) {
      return bag.toFailure()
    }

    const acceptedNames = new Set<string>([
      'package.tgz',
      `${request.packageName}.tgz`,
      `${request.packageName}@${request.packageVersion}.tgz`,
    ])

    const matchedAssets = releaseResult.value.data.assets.filter((asset) => acceptedNames.has(asset.name))

    if (matchedAssets.length === 0) {
      bag.addError(
        'PUBLISH_ACTION_RELEASE_ASSET_NOT_FOUND',
        `No publishable asset found on release "${request.releaseTag}" in ${request.packageSource.fullName}.`,
        {
          releaseTag: request.releaseTag,
          acceptedNames: Array.from(acceptedNames),
        },
        'Upload exactly one asset named package.tgz, <package-name>.tgz, or <package-name>@<package-version>.tgz.',
      )
      return bag.toFailure()
    }

    if (matchedAssets.length > 1) {
      bag.addError(
        'PUBLISH_ACTION_RELEASE_ASSET_AMBIGUOUS',
        `Multiple publishable assets found on release "${request.releaseTag}"; publish asset is ambiguous.`,
        {
          releaseTag: request.releaseTag,
          matchedAssets: matchedAssets.map((asset) => asset.name),
        },
        'Keep exactly one accepted publish asset on the release.',
      )
      return bag.toFailure()
    }

    this.logger.info(
      `Resolved publish asset "${matchedAssets[0].name}" on ${request.packageSource.fullName}@${request.releaseTag}.`,
    )

    return bag.toResult(matchedAssets[0].name)
  }
}
