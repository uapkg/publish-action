import type { GitHubApi } from '../src/contracts/GitHubContracts.js'
import { GitHubApiExecutor } from '../src/services/GitHubApiExecutor.js'
import { RegistryIssueService } from '../src/services/RegistryIssueService.js'

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
}

describe('RegistryIssueService', () => {
  function createApi(options?: {
    readonly existingItems?: readonly {
      number: number
      html_url: string
      title: string
      pull_request?: unknown
    }[]
    readonly authError?: Error
    readonly searchError?: Error
    readonly createError?: Error
  }): {
    readonly api: GitHubApi
    readonly createCalls: { title: string; body: string }[]
  } {
    const createCalls: { title: string; body: string }[] = []

    const api: GitHubApi = {
      rest: {
        users: {
          getAuthenticated: async () => {
            if (options?.authError) {
              throw options.authError
            }

            return { data: { login: 'token-user' } }
          },
        },
        repos: {
          getReleaseByTag: async () => ({ data: { assets: [] } }),
        },
        issues: {
          create: async (params) => {
            if (options?.createError) {
              throw options.createError
            }

            createCalls.push({ title: params.title, body: params.body })
            return {
              data: {
                number: 42,
                html_url: 'https://github.com/uapkg/registry/issues/42',
              },
            }
          },
        },
      },
      search: {
        issuesAndPullRequests: async () => {
          if (options?.searchError) {
            throw options.searchError
          }

          return {
            data: {
              items: options?.existingItems ?? [],
            },
          }
        },
      },
    }

    return { api, createCalls }
  }

  const request = {
    registryRepo: {
      owner: 'uapkg',
      name: 'registry',
      fullName: 'uapkg/registry',
    },
    existingRequestPolicy: 'reuse-existing' as const,
    packageName: 'my-package',
    packageVersion: '1.2.0',
    packageSource: 'org/repo',
    releaseTag: 'v1.2.0',
  }

  it('reuses an existing issue with reuse-existing policy', async () => {
    const { api, createCalls } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0',
        },
      ],
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)
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
          title: '[publish] my-package@1.2.0',
        },
      ],
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)
    const result = await service.createOrReuse({
      ...request,
      existingRequestPolicy: 'fail-if-existing',
    })

    expect(result.ok).toBe(false)
  })

  it('creates a new issue for create-new policy', async () => {
    const { api, createCalls } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0',
        },
      ],
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)
    const result = await service.createOrReuse({
      ...request,
      existingRequestPolicy: 'create-new',
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

  it('adds warning diagnostics when multiple matching issues exist', async () => {
    const { api } = createApi({
      existingItems: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0',
        },
        {
          number: 8,
          html_url: 'https://github.com/uapkg/registry/issues/8',
          title: '[publish] my-package@1.2.0',
        },
      ],
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)

    const result = await service.createOrReuse(request)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.issueNumber).toBe(7)
    expect(result.diagnostics.some((d) => d.code === 'PUBLISH_ACTION_DUPLICATE_ISSUES_WARNING')).toBe(true)
  })

  it('fails when authentication lookup fails during existing issue search', async () => {
    const { api } = createApi({
      authError: Object.assign(new Error('unauthorized'), {
        status: 401,
        response: { headers: {} },
      }),
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)

    const result = await service.createOrReuse(request)

    expect(result.ok).toBe(false)
  })

  it('fails when create issue API call fails', async () => {
    const { api } = createApi({
      createError: Object.assign(new Error('not found'), {
        status: 404,
        response: { headers: {} },
      }),
    })

    const service = new RegistryIssueService(api, new GitHubApiExecutor(logger), logger)

    const result = await service.createOrReuse({
      ...request,
      existingRequestPolicy: 'create-new',
    })

    expect(result.ok).toBe(false)
  })
})
