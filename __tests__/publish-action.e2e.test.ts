import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

interface MockManifest {
  readonly name: string
  readonly version: string
  readonly kind: 'plugin' | 'project'
}

interface MockIssueItem {
  readonly number: number
  readonly html_url: string
  readonly title: string
  readonly pull_request?: unknown
}

interface MockState {
  readonly manifestResult:
    | { ok: true; value: MockManifest; diagnostics: readonly [] }
    | { ok: false; diagnostics: readonly [] }
  readonly releaseAssets: readonly { id: number; name: string }[]
  readonly existingIssues: readonly MockIssueItem[]
  readonly authenticatedLogin: string
  readonly createdIssue: { number: number; html_url: string }
  readonly authErrors: MockRequestError[]
  readonly releaseByTagErrors: MockRequestError[]
  readonly searchErrors: MockRequestError[]
  readonly createIssueErrors: MockRequestError[]
}

interface MockRequestError {
  readonly status: number
  readonly message: string
  readonly response?: {
    readonly headers?: Record<string, string>
  }
}

const getAuthenticated = jest.fn(async () => {
  const error = state.authErrors.shift()
  if (error) {
    throw error
  }

  return {
    data: { login: state.authenticatedLogin },
  }
})

const getReleaseByTag = jest.fn(async () => {
  const error = state.releaseByTagErrors.shift()
  if (error) {
    throw error
  }

  return {
    data: { assets: state.releaseAssets },
  }
})

const createIssue = jest.fn(async () => {
  const error = state.createIssueErrors.shift()
  if (error) {
    throw error
  }

  return { data: state.createdIssue }
})

const searchIssuesAndPullRequests = jest.fn(async () => {
  const error = state.searchErrors.shift()
  if (error) {
    throw error
  }

  return {
    data: { items: state.existingIssues },
  }
})

const octokitConstructor = jest.fn()

let state: MockState = {
  manifestResult: {
    ok: true,
    value: {
      name: 'my-package',
      version: '1.2.0',
      kind: 'plugin',
    },
    diagnostics: [],
  },
  releaseAssets: [{ id: 1, name: 'my-package@1.2.0.tgz' }],
  existingIssues: [],
  authenticatedLogin: 'token-user',
  createdIssue: {
    number: 42,
    html_url: 'https://github.com/uapkg/registry/issues/42',
  },
  authErrors: [],
  releaseByTagErrors: [],
  searchErrors: [],
  createIssueErrors: [],
}

function createRequestError(status: number, message: string, rateLimitRemaining?: string): MockRequestError {
  if (rateLimitRemaining !== undefined) {
    return {
      status,
      message,
      response: {
        headers: {
          'x-ratelimit-remaining': rateLimitRemaining,
        },
      },
    }
  }

  return {
    status,
    message,
  }
}

class MockManifestReader {
  async read(): Promise<MockState['manifestResult']> {
    return state.manifestResult
  }
}

class MockOctokit {
  readonly rest = {
    users: {
      getAuthenticated,
    },
    repos: {
      getReleaseByTag,
    },
    issues: {
      create: createIssue,
    },
  }

  readonly search = {
    issuesAndPullRequests: searchIssuesAndPullRequests,
  }

  constructor(options: { auth?: string }) {
    octokitConstructor(options)
  }
}

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@uapkg/package-manifest', () => ({
  ManifestReader: MockManifestReader,
}))
jest.unstable_mockModule('@octokit/action', () => ({
  Octokit: MockOctokit,
}))
jest.unstable_mockModule('@uapkg/log', () => ({
  __esModule: true,
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
  configureLogger: () => undefined,
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}))

const { run } = await import('../src/main.js')

describe('publish action e2e', () => {
  const envSnapshot = { ...process.env }

  const summary = core.summary as unknown as {
    addRaw: jest.MockedFunction<(message: string) => typeof core.summary>
    write: jest.MockedFunction<(options?: { overwrite?: boolean }) => Promise<void>>
  }

  const inputValues: Record<string, string> = {
    token: 'token-value',
    'registry-repo': 'uapkg/registry',
    'manifest-path': 'uapkg.json',
    'release-tag': '',
    'existing-request-policy': 'reuse-existing',
  }

  beforeEach(() => {
    jest.clearAllMocks()

    summary.addRaw.mockReturnValue(summary)
    summary.write.mockResolvedValue(undefined)

    state = {
      manifestResult: {
        ok: true,
        value: {
          name: 'my-package',
          version: '1.2.0',
          kind: 'plugin',
        },
        diagnostics: [],
      },
      releaseAssets: [{ id: 1, name: 'my-package@1.2.0.tgz' }],
      existingIssues: [],
      authenticatedLogin: 'token-user',
      createdIssue: {
        number: 42,
        html_url: 'https://github.com/uapkg/registry/issues/42',
      },
      authErrors: [],
      releaseByTagErrors: [],
      searchErrors: [],
      createIssueErrors: [],
    }

    inputValues.token = 'token-value'
    inputValues['registry-repo'] = 'uapkg/registry'
    inputValues['manifest-path'] = 'uapkg.json'
    inputValues['release-tag'] = ''
    inputValues['existing-request-policy'] = 'reuse-existing'

    core.getInput.mockImplementation((name: string) => inputValues[name] ?? '')

    process.env = { ...envSnapshot }
    process.env.GITHUB_REPOSITORY = 'uapkg/source-repo'
    process.env.GITHUB_REF_TYPE = 'tag'
    process.env.GITHUB_REF_NAME = 'v1.2.0'
  })

  afterAll(() => {
    process.env = envSnapshot
  })

  it('creates a publish issue and emits outputs on success', async () => {
    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(octokitConstructor).toHaveBeenCalledWith({ auth: 'token-value' })
    expect(getReleaseByTag).toHaveBeenCalledWith({
      owner: 'uapkg',
      repo: 'source-repo',
      tag: 'v1.2.0',
    })
    expect(searchIssuesAndPullRequests).toHaveBeenCalledTimes(1)
    expect(createIssue).toHaveBeenCalledTimes(1)

    expect(core.setOutput).toHaveBeenCalledWith('issue-number', 42)
    expect(core.setOutput).toHaveBeenCalledWith('issue-url', 'https://github.com/uapkg/registry/issues/42')
    expect(core.setOutput).toHaveBeenCalledWith('issue-state', 'created')
    expect(core.setOutput).toHaveBeenCalledWith('package-name', 'my-package')
    expect(core.setOutput).toHaveBeenCalledWith('package-version', '1.2.0')
    expect(core.setOutput).toHaveBeenCalledWith('package-source', 'uapkg/source-repo')
    expect(core.setOutput).toHaveBeenCalledWith('release-tag', 'v1.2.0')

    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('- Status: success'))
    expect(summary.write).toHaveBeenCalledWith({ overwrite: false })
  })

  it('reuses existing matching issue under reuse-existing policy', async () => {
    state = {
      ...state,
      existingIssues: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0',
        },
      ],
    }

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(createIssue).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('issue-number', 7)
    expect(core.setOutput).toHaveBeenCalledWith('issue-state', 'existing')
  })

  it('fails when release has ambiguous publish assets', async () => {
    state = {
      ...state,
      releaseAssets: [
        { id: 1, name: 'package.tgz' },
        { id: 2, name: 'my-package@1.2.0.tgz' },
      ],
    }

    await run()

    expect(createIssue).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('publishable assets found'))
    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('- Status: failed'))
  })

  it('fails when policy is fail-if-existing and issue already exists', async () => {
    inputValues['existing-request-policy'] = 'fail-if-existing'
    state = {
      ...state,
      existingIssues: [
        {
          number: 7,
          html_url: 'https://github.com/uapkg/registry/issues/7',
          title: '[publish] my-package@1.2.0',
        },
      ],
    }

    await run()

    expect(createIssue).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Existing publish request found'))
  })

  it('maps 401 API failures to invalid token messaging', async () => {
    state = {
      ...state,
      releaseByTagErrors: [createRequestError(401, 'Bad credentials')],
    }

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('token is invalid or expired'))
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('maps 403 rate-limit failures to rate-limit messaging', async () => {
    state = {
      ...state,
      releaseByTagErrors: [createRequestError(403, 'API rate limit exceeded', '0')],
    }

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('token rate limit is exhausted'))
  })

  it('maps 403 permission failures to permission messaging', async () => {
    state = {
      ...state,
      releaseByTagErrors: [createRequestError(403, 'Resource not accessible by integration', '10')],
    }

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('token lacks required permissions'))
  })

  it('maps 404 API failures to not-found messaging', async () => {
    state = {
      ...state,
      createIssueErrors: [createRequestError(404, 'Not Found')],
    }

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('repository/resource not found or inaccessible'),
    )
  })

  it('retries one transient 5xx failure and then succeeds', async () => {
    state = {
      ...state,
      releaseByTagErrors: [createRequestError(500, 'Internal Server Error')],
    }

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(getReleaseByTag).toHaveBeenCalledTimes(2)
    expect(createIssue).toHaveBeenCalledTimes(1)
    expect(core.setOutput).toHaveBeenCalledWith('issue-state', 'created')
  })
})
