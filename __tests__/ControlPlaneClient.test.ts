import { jest } from '@jest/globals'
import { ControlPlaneClient, type ControlPlaneError } from '../src/services/ControlPlaneClient.js'

describe('ControlPlaneClient', () => {
  it('exchanges GitHub OIDC only at the pinned endpoint and audience', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, token: 'session-secret', expiresAt: 1_800_000_000 }))
    const client = new ControlPlaneClient(fetchMock)

    await expect(client.exchangeGitHubActionsToken('github-secret')).resolves.toEqual({
      token: 'session-secret',
      expiresAt: 1_800_000_000,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.uapkg.dev/v1/github-user-app/oidc/github-actions/exchange')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: 'github_actions',
      idToken: 'github-secret',
      audience: 'uapkg',
    })
  })

  it('submits release coordinates with the OIDC session and idempotency key', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, requestId: 'req_1', status: 'queued' }, { status: 202 }))
    const client = new ControlPlaneClient(fetchMock)
    const submission = {
      registryId: '11111111-1111-4111-8111-111111111111',
      kind: 'publish_new_version' as const,
      payload: {
        packageName: '@acme/example',
        packageVersion: '1.2.3',
        source: {
          type: 'github_release' as const,
          repository: 'acme/example',
          releaseTag: 'v1.2.3',
          assetName: 'package.tgz',
          pathToManifest: 'uapkg.json',
        },
      },
    }

    await expect(client.submitPublishRequest('session-secret', 'idem-1', submission)).resolves.toEqual({
      requestId: 'req_1',
      status: 'queued',
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.uapkg.dev/v1/registry-requests')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer session-secret',
      'x-uapkg-idempotency-key': 'idem-1',
    })
    expect(JSON.parse(String(init?.body))).toEqual(submission)
  })

  it('retrieves caller-owned request status', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        request: { id: 'req/one', status: 'accepted' },
      }),
    )
    const client = new ControlPlaneClient(fetchMock)

    await expect(client.getPublishRequest('session-secret', 'req/one')).resolves.toEqual({
      request: { id: 'req/one', status: 'accepted' },
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.uapkg.dev/v1/registry-requests/req%2Fone')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer session-secret',
    })
  })

  it('returns a bounded server error without exposing response bodies', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          error: {
            code: 'OIDC_RULE_NOT_FOUND',
            message: 'No exact-package trusted publisher rule matched.',
            ignoredSecret: 'must-not-surface',
          },
        },
        { status: 400 },
      ),
    )
    const client = new ControlPlaneClient(fetchMock)

    await expect(client.exchangeGitHubActionsToken('github-secret')).rejects.toMatchObject({
      name: 'ControlPlaneError',
      code: 'OIDC_RULE_NOT_FOUND',
      status: 400,
      message: 'No exact-package trusted publisher rule matched.',
    } satisfies Partial<ControlPlaneError>)
  })

  it('rejects malformed success responses', async () => {
    const client = new ControlPlaneClient(jest.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true })))
    await expect(client.exchangeGitHubActionsToken('github-secret')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
})
