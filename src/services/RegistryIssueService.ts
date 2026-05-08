import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type {
  PublishIssueRequest,
  PublishIssueResult
} from '../contracts/ActionContracts.js'
import type {
  GitHubIssueItem,
  GitHubApi
} from '../contracts/GitHubContracts.js'
import type { ActionLogger } from './ActionLogger.js'
import { GitHubApiExecutor } from './GitHubApiExecutor.js'

export class RegistryIssueService {
  constructor(
    private readonly api: GitHubApi,
    private readonly apiExecutor: GitHubApiExecutor,
    private readonly logger: ActionLogger
  ) {}

  async createOrReuse(
    request: PublishIssueRequest
  ): Promise<Result<PublishIssueResult>> {
    const bag = new DiagnosticBag()

    const title = this.getIssueTitle(
      request.packageName,
      request.packageVersion
    )
    const body = this.getIssueBody(
      request.packageName,
      request.packageVersion,
      request.packageSource,
      request.releaseTag
    )

    if (request.existingRequestPolicy !== 'create-new') {
      const existingIssueResult = await this.findExistingIssue(
        request.registryRepo.fullName,
        title
      )

      bag.mergeArray(existingIssueResult.diagnostics)
      if (!existingIssueResult.ok) {
        return bag.toFailure()
      }

      const existingIssue = existingIssueResult.value
      if (existingIssue) {
        if (request.existingRequestPolicy === 'fail-if-existing') {
          bag.addError(
            'PUBLISH_ACTION_EXISTING_ISSUE_FOUND',
            `Existing publish request found: ${existingIssue.html_url}.`,
            {
              issueNumber: existingIssue.number,
              issueUrl: existingIssue.html_url
            },
            'Switch existing-request-policy to reuse-existing or create-new.'
          )
          return bag.toFailure()
        }

        this.logger.info(
          `Reusing existing publish issue #${existingIssue.number} (${existingIssue.html_url}).`
        )

        return bag.toResult({
          issueNumber: existingIssue.number,
          issueUrl: existingIssue.html_url,
          issueState: 'existing'
        })
      }
    }

    const createIssueResult = await this.apiExecutor.execute(
      'create registry publish issue',
      () =>
        this.api.rest.issues.create({
          owner: request.registryRepo.owner,
          repo: request.registryRepo.name,
          title,
          body
        })
    )

    bag.mergeArray(createIssueResult.diagnostics)
    if (!createIssueResult.ok) {
      return bag.toFailure()
    }

    this.logger.info(
      `Created publish issue #${createIssueResult.value.data.number} (${createIssueResult.value.data.html_url}).`
    )

    return bag.toResult({
      issueNumber: createIssueResult.value.data.number,
      issueUrl: createIssueResult.value.data.html_url,
      issueState: 'created'
    })
  }

  private async findExistingIssue(
    registryRepo: string,
    title: string
  ): Promise<Result<GitHubIssueItem | undefined>> {
    const bag = new DiagnosticBag()

    const authResult = await this.apiExecutor.execute(
      'get authenticated user',
      () => this.api.rest.users.getAuthenticated()
    )
    bag.mergeArray(authResult.diagnostics)

    if (!authResult.ok) {
      return bag.toFailure()
    }

    const authorLogin = authResult.value.data.login

    const query = [
      `repo:${registryRepo}`,
      'is:issue',
      'is:open',
      `author:${authorLogin}`,
      'in:title',
      `"${title}"`
    ].join(' ')

    const searchResult = await this.apiExecutor.execute(
      'search existing publish issues',
      () => this.api.search.issuesAndPullRequests({ q: query, per_page: 20 })
    )

    bag.mergeArray(searchResult.diagnostics)
    if (!searchResult.ok) {
      return bag.toFailure()
    }

    const issuesOnly = searchResult.value.data.items.filter(
      (item) => item.pull_request === undefined
    )

    const titleMatches = issuesOnly.filter((item) => item.title === title)

    if (titleMatches.length > 1) {
      bag.addWarning(
        'PUBLISH_ACTION_DUPLICATE_ISSUES_WARNING',
        `Found ${titleMatches.length} matching open publish issues. Reusing the first result.`,
        { title, count: titleMatches.length }
      )
    }

    return bag.toResult(titleMatches[0])
  }

  private getIssueTitle(packageName: string, packageVersion: string): string {
    return `[publish] ${packageName}@${packageVersion}`
  }

  private getIssueBody(
    packageName: string,
    packageVersion: string,
    packageSource: string,
    releaseTag: string
  ): string {
    return [
      '### Package Name',
      packageName,
      '',
      '### Version',
      packageVersion,
      '',
      '### Source',
      packageSource,
      '',
      '### Ref',
      releaseTag
    ].join('\n')
  }
}
