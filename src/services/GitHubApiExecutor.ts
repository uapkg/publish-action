import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type { ActionLogger } from './ActionLogger.js'

interface RequestErrorLike {
  readonly status?: number
  readonly response?: {
    readonly headers?: Record<string, string | undefined>
  }
  readonly message?: string
}

const MAX_TRANSIENT_RETRIES = 1

export class GitHubApiExecutor {
  constructor(private readonly logger: ActionLogger) {}

  async execute<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<Result<T>> {
    const bag = new DiagnosticBag()

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        const value = await operation()
        return bag.toResult(value)
      } catch (error) {
        const requestError = error as RequestErrorLike
        const status = requestError.status

        if (
          typeof status === 'number' &&
          status >= 500 &&
          attempt < MAX_TRANSIENT_RETRIES
        ) {
          this.logger.warn(
            `GitHub API call "${operationName}" failed with status ${status}. Retrying once.`
          )
          continue
        }

        bag.addError(
          'PUBLISH_ACTION_GITHUB_API_ERROR',
          this.toMessage(operationName, requestError),
          {
            operationName,
            status,
            reason: this.getErrorReason(requestError)
          },
          this.toHint(requestError)
        )

        return bag.toFailure()
      }
    }

    bag.addError(
      'PUBLISH_ACTION_GITHUB_API_ERROR',
      `GitHub API call "${operationName}" failed after retry.`,
      { operationName }
    )
    return bag.toFailure()
  }

  private getErrorReason(error: RequestErrorLike): string {
    return error.message ?? 'Unknown GitHub API failure'
  }

  private toMessage(operationName: string, error: RequestErrorLike): string {
    const status = error.status
    if (status === 401) {
      return `GitHub API call "${operationName}" failed with 401: token is invalid or expired.`
    }

    if (status === 403) {
      if (this.isRateLimited(error)) {
        return `GitHub API call "${operationName}" failed with 403: token rate limit is exhausted.`
      }

      return `GitHub API call "${operationName}" failed with 403: token lacks required permissions.`
    }

    if (status === 404) {
      return `GitHub API call "${operationName}" failed with 404: repository/resource not found or inaccessible.`
    }

    if (typeof status === 'number' && status >= 500) {
      return `GitHub API call "${operationName}" failed with ${status}: transient GitHub API failure.`
    }

    if (typeof status === 'number') {
      return `GitHub API call "${operationName}" failed with status ${status}: ${this.getErrorReason(error)}.`
    }

    return `GitHub API call "${operationName}" failed: ${this.getErrorReason(error)}.`
  }

  private toHint(error: RequestErrorLike): string {
    const status = error.status

    if (status === 401) {
      return 'Use a valid token with access to the source and registry repositories.'
    }

    if (status === 403 && this.isRateLimited(error)) {
      return 'Wait for the token rate limit to reset or use a different token.'
    }

    if (status === 403) {
      return 'Ensure the token has permissions to read releases and create/search issues.'
    }

    if (status === 404) {
      return 'Verify repository names and token access to those repositories.'
    }

    if (typeof status === 'number' && status >= 500) {
      return 'Retry the workflow run later if GitHub is experiencing transient failures.'
    }

    return 'Check token permissions and GitHub API availability.'
  }

  private isRateLimited(error: RequestErrorLike): boolean {
    const remaining = error.response?.headers?.['x-ratelimit-remaining']
    return remaining === '0'
  }
}
