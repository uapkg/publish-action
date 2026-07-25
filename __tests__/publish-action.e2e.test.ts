import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

interface MockManifest {
  readonly name: string
  readonly version: string
  readonly kind: 'plugin' | 'project'
}

let manifestResult:
  | { ok: true; value: MockManifest; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly [] } = {
  ok: true,
  value: { name: 'my-package', version: '1.2.0', kind: 'plugin' },
  diagnostics: [],
}

class MockManifestReader {
  async read(): Promise<typeof manifestResult> {
    return manifestResult
  }
}

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@uapkg/package-manifest', () => ({ ManifestReader: MockManifestReader }))
jest.unstable_mockModule('@uapkg/log', () => ({
  __esModule: true,
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}))

const { run } = await import('../src/main.js')

describe('publish action e2e', () => {
  const envSnapshot = { ...process.env }
  const originalFetch = globalThis.fetch
  const inputValues: Record<string, string> = {
    'registry-id': '11111111-1111-4111-8111-111111111111',
    'manifest-path': 'uapkg.json',
    'release-tag': '',
    asset: '',
    detach: '',
  }

  const summary = core.summary as unknown as {
    addRaw: jest.MockedFunction<(message: string) => typeof core.summary>
    write: jest.MockedFunction<(options?: { overwrite?: boolean }) => Promise<void>>
  }

  beforeEach(() => {
    jest.clearAllMocks()
    manifestResult = {
      ok: true,
      value: { name: 'my-package', version: '1.2.0', kind: 'plugin' },
      diagnostics: [],
    }
    inputValues.detach = ''
    core.getInput.mockImplementation((name: string) => inputValues[name] ?? '')
    core.getIDToken.mockResolvedValue('github-id-secret')
    summary.addRaw.mockReturnValue(core.summary)
    summary.write.mockResolvedValue(undefined)

    process.env = {
      ...envSnapshot,
      GITHUB_REPOSITORY: 'uapkg/source-repo',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v1.2.0',
      GITHUB_RUN_ID: '12345',
      GITHUB_JOB: 'publish',
      GITHUB_WORKSPACE: process.cwd(),
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  afterAll(() => {
    process.env = envSnapshot
    globalThis.fetch = originalFetch
  })

  it('exchanges OIDC, submits an existing-package request, and polls to acceptance', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'session-secret', expiresAt: 2_000_000_000 }))
      .mockResolvedValueOnce(Response.json({ ok: true, requestId: 'req_42', status: 'queued' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ ok: true, request: { id: 'req_42', status: 'accepted' } }))
    globalThis.fetch = fetchMock

    jest.useFakeTimers()
    try {
      const runPromise = run()
      await jest.advanceTimersByTimeAsync(5_000)
      await runPromise
    } finally {
      jest.useRealTimers()
    }

    expect(core.getIDToken).toHaveBeenCalledWith('uapkg')
    expect(core.setSecret).toHaveBeenCalledWith('github-id-secret')
    expect(core.setSecret).toHaveBeenCalledWith('session-secret')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const submit = fetchMock.mock.calls[1]
    expect(submit?.[0]).toBe('https://api.uapkg.dev/v1/registry-requests')
    expect(submit?.[1]?.headers).toMatchObject({
      authorization: 'Bearer session-secret',
      'x-uapkg-idempotency-key': expect.stringMatching(/^gha-[0-9a-f]{64}$/),
    })
    expect(JSON.parse(String(submit?.[1]?.body))).toEqual({
      registryId: '11111111-1111-4111-8111-111111111111',
      kind: 'publish_new_version',
      payload: {
        packageName: 'my-package',
        packageVersion: '1.2.0',
        source: {
          type: 'github_release',
          repository: 'uapkg/source-repo',
          releaseTag: 'v1.2.0',
          assetName: 'package.tgz',
          pathToManifest: 'uapkg.json',
        },
      },
    })
    expect(core.setOutput).toHaveBeenCalledWith('request-id', 'req_42')
    expect(core.setOutput).toHaveBeenCalledWith('request-status', 'accepted')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('- Status: accepted'))
  })

  it('does not poll when detach is true', async () => {
    inputValues.detach = 'true'
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'session-secret', expiresAt: 2_000_000_000 }))
      .mockResolvedValueOnce(Response.json({ ok: true, requestId: 'req_42', status: 'queued' }, { status: 202 }))
    globalThis.fetch = fetchMock

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(core.setOutput).toHaveBeenCalledWith('request-status', 'queued')
    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('- Status: submitted'))
  })

  it('fails closed when the trusted-publisher exchange is rejected', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          error: { code: 'OIDC_RULE_NOT_FOUND', message: 'No exact-package trusted publisher rule matched.' },
        },
        { status: 400 },
      ),
    )
    globalThis.fetch = fetchMock

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(core.setFailed).toHaveBeenCalledWith('No exact-package trusted publisher rule matched.')
    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('- Status: failed'))
  })
})
