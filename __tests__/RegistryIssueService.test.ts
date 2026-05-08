import type { GitHubApi } from '../src/contracts/GitHubContracts.js'
import { GitHubApiExecutor } from '../src/services/GitHubApiExecutor.js'
import { RegistryIssueService } from '../src/services/RegistryIssueService.js'

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}

describe('RegistryIssueService', () => {
  function createApi(options?: {
    readonly existingItems?: readonly {
      number: number
      html_url: string
      title: string
    }[]
  }): {
    readonly api: GitHubApi
    readonly createCalls: { title: string; body: string }[]
  } {
    const createCalls: { title: string; body: string }[] = []

    const api: GitHubApi = {
      rest: {
        users: {
          getAuthenticated: async () => ({ data: { login: 'token-user' } })
        },
        repos: {
          getReleaseByTag: async () => ({ data: { assets: [] } })
        },
        issues: {
          create: async (params) => {
            createCalls.push({ title: params.title, body: params.body })
            return {
              data: {
                number: 42,
                html_url: 'https://github.com/uapkg/registry/issues/42'
              }
            }
          }
        }
      },
      search: {
        issuesAndPullRequests: async () => ({
          data: {
            items: options?.existingItems ?? []
          }
        })
      }
    }

    return { api, createCalls }
  }

  const request = {
    registryRepo: {
      owner: 'uapkg',
      name: 'registry',
      fullName: 'uapkg/registry'
    },
    existingRequestPolicy: 'reuse-existing' as const,
    packageName: 'my-package',
    packageVersion: '1.2.0',
    packageSource: 'org/repo',
    releaseTag: 'v1.2.0'
  }

  it('reuses an existing issue with reuse-existing policy', async () => {
    const { api, createCalls } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0'
        }
      ]
    })

    const service = new RegistryIssueService(
      api,
      new GitHubApiExecutor(logger),
      logger
    )
    const result = await service.createOrReuse(request)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.issueState).toBe('existing')
    expect(result.value.issueNumber).toBe(7)
    expect(createCalls).toHaveLength(0)
  })

  it('fails when fail-if-existing policy finds an issue', async () => {
    const { api } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0'
        }
      ]
    })

    const service = new RegistryIssueService(
      api,
      new GitHubApiExecutor(logger),
      logger
    )
    const result = await service.createOrReuse({
      ...request,
      existingRequestPolicy: 'fail-if-existing'
    })

    expect(result.ok).toBe(false)
  })

  it('creates a new issue for create-new policy', async () => {
    const { api, createCalls } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0'
        }
      ]
    })

    const service = new RegistryIssueService(
      api,
      new GitHubApiExecutor(logger),
      logger
    )
    const result = await service.createOrReuse({
      ...request,
      existingRequestPolicy: 'create-new'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.issueState).toBe('created')
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].title).toBe('[publish] my-package@1.2.0')
    expect(createCalls[0].body).toContain('### Package Name')
    expect(createCalls[0].body).toContain('my-package')
  })
})
