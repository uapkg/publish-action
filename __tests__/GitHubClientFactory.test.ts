import { jest } from '@jest/globals'

const octokitConstructor = jest.fn()

class MockOctokit {
  constructor(options: { auth?: string }) {
    octokitConstructor(options)
  }
}

jest.unstable_mockModule('@octokit/action', () => ({
  Octokit: MockOctokit
}))

const { GitHubClientFactory } =
  await import('../src/services/GitHubClientFactory.js')

describe('GitHubClientFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates an authenticated octokit client', () => {
    const factory = new GitHubClientFactory()
    const result = factory.create('token-value')

    expect(result.ok).toBe(true)
    expect(octokitConstructor).toHaveBeenCalledWith({ auth: 'token-value' })
  })

  it('returns diagnostics when octokit construction fails', async () => {
    const { GitHubClientFactory: ThrowingFactory } =
      await import('../src/services/GitHubClientFactory.js')

    octokitConstructor.mockImplementationOnce(() => {
      throw new Error('construction failed')
    })

    const factory = new ThrowingFactory()
    const result = factory.create('token-value')

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.diagnostics[0]?.code).toBe(
      'PUBLISH_ACTION_OCTOKIT_INIT_FAILED'
    )
  })
})
