import { jest } from '@jest/globals'
import { GitHubApiExecutor } from '../src/services/GitHubApiExecutor.js'

describe('GitHubApiExecutor', () => {
  const logger = {
    info: () => undefined,
    warn: jest.fn(),
    error: () => undefined,
    debug: () => undefined
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retries one transient 5xx failure and succeeds', async () => {
    const executor = new GitHubApiExecutor(logger)

    let attempt = 0
    const result = await executor.execute('retryable call', async () => {
      attempt += 1
      if (attempt === 1) {
        throw { status: 503, message: 'Service unavailable' }
      }

      return { ok: true }
    })

    expect(result.ok).toBe(true)
    expect(attempt).toBe(2)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Retrying once')
    )
  })

  it('maps status-specific failures to clear diagnostics', async () => {
    const executor = new GitHubApiExecutor(logger)

    const statuses = [
      {
        status: 401,
        message: 'Bad credentials',
        expectedText: 'invalid or expired'
      },
      {
        status: 403,
        message: 'Forbidden',
        expectedText: 'lacks required permissions'
      },
      {
        status: 404,
        message: 'Not Found',
        expectedText: 'not found or inaccessible'
      },
      {
        status: 418,
        message: 'Teapot',
        expectedText: 'status 418'
      }
    ] as const

    for (const statusCase of statuses) {
      const result = await executor.execute('status mapping test', async () => {
        throw { status: statusCase.status, message: statusCase.message }
      })

      expect(result.ok).toBe(false)
      if (result.ok) {
        continue
      }

      expect(result.diagnostics[0]?.message).toContain(statusCase.expectedText)
    }
  })

  it('maps 403 rate limit exhaustion and unknown errors', async () => {
    const executor = new GitHubApiExecutor(logger)

    const rateLimitedResult = await executor.execute(
      'rate limited call',
      async () => {
        throw {
          status: 403,
          message: 'API rate limit exceeded',
          response: {
            headers: {
              'x-ratelimit-remaining': '0'
            }
          }
        }
      }
    )

    expect(rateLimitedResult.ok).toBe(false)
    if (!rateLimitedResult.ok) {
      expect(rateLimitedResult.diagnostics[0]?.message).toContain(
        'rate limit is exhausted'
      )
      expect(rateLimitedResult.diagnostics[0]?.hint).toContain(
        'rate limit to reset'
      )
    }

    const unknownResult = await executor.execute(
      'unknown failure',
      async () => {
        throw new Error('network closed')
      }
    )

    expect(unknownResult.ok).toBe(false)
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics[0]?.message).toContain(
        'GitHub API call "unknown failure" failed'
      )
      expect(unknownResult.diagnostics[0]?.hint).toContain(
        'GitHub API availability'
      )
    }
  })

  it('returns transient-failure messaging after a retry is exhausted', async () => {
    const executor = new GitHubApiExecutor(logger)

    const result = await executor.execute('persistent failure', async () => {
      throw { status: 500, message: 'still failing' }
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.diagnostics[0]?.message).toContain(
      'transient GitHub API failure'
    )
    expect(result.diagnostics[0]?.hint).toContain(
      'GitHub is experiencing transient failures'
    )
  })
})
