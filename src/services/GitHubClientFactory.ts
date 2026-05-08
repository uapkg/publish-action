import { Octokit } from '@octokit/action'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type { GitHubApi } from '../contracts/GitHubContracts.js'

export class GitHubClientFactory {
  create(token: string): Result<GitHubApi> {
    const bag = new DiagnosticBag()

    try {
      const api = new Octokit({ auth: token }) as unknown as GitHubApi
      return bag.toResult(api)
    } catch (error) {
      bag.addError(
        'PUBLISH_ACTION_OCTOKIT_INIT_FAILED',
        `Failed to initialize GitHub API client: ${String(error)}.`,
        { reason: String(error) },
        'Ensure the "token" input is a valid GitHub token.',
      )
      return bag.toFailure()
    }
  }
}
