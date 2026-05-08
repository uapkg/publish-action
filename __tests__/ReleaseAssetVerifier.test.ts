import type { GitHubApi } from '../src/contracts/GitHubContracts.js'
import { GitHubApiExecutor } from '../src/services/GitHubApiExecutor.js'
import { ReleaseAssetVerifier } from '../src/services/ReleaseAssetVerifier.js'

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}

describe('ReleaseAssetVerifier', () => {
  function createApi(assetNames: readonly string[]): GitHubApi {
    return {
      rest: {
        users: {
          getAuthenticated: async () => ({ data: { login: 'octocat' } })
        },
        repos: {
          getReleaseByTag: async () => ({
            data: {
              assets: assetNames.map((name, index) => ({ id: index + 1, name }))
            }
          })
        },
        issues: {
          create: async () => ({
            data: { number: 1, html_url: 'https://example.test/issues/1' }
          })
        }
      },
      search: {
        issuesAndPullRequests: async () => ({ data: { items: [] } })
      }
    }
  }

  it('accepts exactly one matching asset', async () => {
    const api = createApi(['my-package@1.2.0.tgz'])
    const verifier = new ReleaseAssetVerifier(
      api,
      new GitHubApiExecutor(logger),
      logger
    )

    const result = await verifier.verify({
      packageSource: { owner: 'org', name: 'repo', fullName: 'org/repo' },
      releaseTag: 'v1.2.0',
      packageName: 'my-package',
      packageVersion: '1.2.0'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value).toBe('my-package@1.2.0.tgz')
  })

  it('fails when no accepted asset exists', async () => {
    const api = createApi(['other-file.zip'])
    const verifier = new ReleaseAssetVerifier(
      api,
      new GitHubApiExecutor(logger),
      logger
    )

    const result = await verifier.verify({
      packageSource: { owner: 'org', name: 'repo', fullName: 'org/repo' },
      releaseTag: 'v1.2.0',
      packageName: 'my-package',
      packageVersion: '1.2.0'
    })

    expect(result.ok).toBe(false)
  })

  it('fails when multiple accepted assets exist', async () => {
    const api = createApi(['package.tgz', 'my-package@1.2.0.tgz'])
    const verifier = new ReleaseAssetVerifier(
      api,
      new GitHubApiExecutor(logger),
      logger
    )

    const result = await verifier.verify({
      packageSource: { owner: 'org', name: 'repo', fullName: 'org/repo' },
      releaseTag: 'v1.2.0',
      packageName: 'my-package',
      packageVersion: '1.2.0'
    })

    expect(result.ok).toBe(false)
  })
})
