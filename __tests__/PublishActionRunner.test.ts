import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { ControlPlaneError } = await import('../src/services/ControlPlaneClient.js')
const { PublishActionRunner, createGitHubActionsIdempotencyKey } = await import(
  '../src/services/PublishActionRunner.js'
)

const inputs = {
  registryId: '11111111-1111-4111-8111-111111111111',
  manifestPath: 'uapkg.json',
  releaseTagInput: undefined,
  assetName: 'package.tgz',
  detach: false,
}
const manifest = {
  packageName: '@acme/example',
  packageVersion: '1.2.3',
  packageSource: 'acme/example',
  manifestPath: 'uapkg.json',
}
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    inputReader: {
      read: () => ({ ok: true as const, diagnostics: [], value: inputs }),
    },
    metadataReader: {
      read: async () => ({ ok: true as const, diagnostics: [], value: manifest }),
    },
    releaseTagResolver: {
      resolve: async () => ({ ok: true as const, diagnostics: [], value: 'v1.2.3' }),
    },
    controlPlaneClient: {
      exchangeGitHubActionsToken: jest.fn(async () => ({
        token: 'session-secret',
        expiresAt: 2_000_000_000,
      })),
      submitPublishRequest: jest.fn(async () => ({ requestId: 'req_1', status: 'queued' as const })),
      getPublishRequest: jest.fn(async () => ({
        request: { id: 'req_1', status: 'accepted' as const },
      })),
    },
    diagnosticReporter: {
      report: jest.fn(() => ({ errors: 0, warnings: 0, infos: 0, formattedDiagnostics: [] })),
    },
    summaryWriter: {
      writeFailure: jest.fn(async () => undefined),
      writeSuccess: jest.fn(async () => undefined),
    },
    idTokenProvider: jest.fn(async () => 'github-id-secret'),
    sleep: jest.fn(async () => undefined),
    nowMilliseconds: jest.fn(() => 1_700_000_000_000),
    idempotencyKeyProvider: () => 'idem-1',
    pollIntervalMilliseconds: 0,
    pollTimeoutMilliseconds: 1_000,
    ...overrides,
  }
}

describe('PublishActionRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('submits only GitHub Release coordinates and polls to acceptance', async () => {
    const deps = dependencies()
    const runner = new PublishActionRunner(logger, deps as never)

    await runner.run()

    expect(deps.idTokenProvider).toHaveBeenCalledTimes(1)
    expect(core.setSecret).toHaveBeenCalledWith('github-id-secret')
    expect(core.setSecret).toHaveBeenCalledWith('session-secret')
    expect(deps.controlPlaneClient.submitPublishRequest).toHaveBeenCalledWith('session-secret', 'idem-1', {
      registryId: inputs.registryId,
      kind: 'publish_new_version',
      payload: {
        packageName: '@acme/example',
        packageVersion: '1.2.3',
        source: {
          type: 'github_release',
          repository: 'acme/example',
          releaseTag: 'v1.2.3',
          assetName: 'package.tgz',
          pathToManifest: 'uapkg.json',
        },
      },
    })
    expect(deps.controlPlaneClient.getPublishRequest).toHaveBeenCalledWith('session-secret', 'req_1')
    expect(core.setOutput).toHaveBeenCalledWith('request-id', 'req_1')
    expect(core.setOutput).toHaveBeenCalledWith('request-status', 'accepted')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(deps.summaryWriter.writeSuccess).toHaveBeenCalledWith(expect.objectContaining({ detached: false }))
  })

  it('derives a stable, coordinate-bound idempotency key across workflow reruns', () => {
    const submission = {
      registryId: inputs.registryId,
      kind: 'publish_new_version' as const,
      payload: {
        packageName: manifest.packageName,
        packageVersion: manifest.packageVersion,
        source: {
          type: 'github_release' as const,
          repository: manifest.packageSource,
          releaseTag: 'v1.2.3',
          assetName: 'package.tgz',
          pathToManifest: manifest.manifestPath,
        },
      },
    }
    const first = createGitHubActionsIdempotencyKey(submission, {
      GITHUB_RUN_ID: '12345',
      GITHUB_JOB: 'publish',
      GITHUB_RUN_ATTEMPT: '1',
    })
    const rerun = createGitHubActionsIdempotencyKey(submission, {
      GITHUB_RUN_ID: '12345',
      GITHUB_JOB: 'publish',
      GITHUB_RUN_ATTEMPT: '2',
    })
    const differentCoordinates = createGitHubActionsIdempotencyKey(
      {
        ...submission,
        payload: {
          ...submission.payload,
          source: { ...submission.payload.source, releaseTag: 'v1.2.4' },
        },
      },
      { GITHUB_RUN_ID: '12345', GITHUB_JOB: 'publish' },
    )

    expect(first).toMatch(/^gha-[0-9a-f]{64}$/)
    expect(rerun).toBe(first)
    expect(differentCoordinates).not.toBe(first)
  })

  it('returns after submission when detached', async () => {
    const deps = dependencies({
      inputReader: {
        read: () => ({ ok: true as const, diagnostics: [], value: { ...inputs, detach: true } }),
      },
    })

    await new PublishActionRunner(logger, deps as never).run()

    expect(deps.controlPlaneClient.getPublishRequest).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('request-status', 'queued')
    expect(deps.summaryWriter.writeSuccess).toHaveBeenCalledWith(expect.objectContaining({ detached: true }))
  })

  it('renews an expiring OIDC session while polling', async () => {
    const exchange = jest
      .fn<() => Promise<{ token: string; expiresAt: number }>>()
      .mockResolvedValueOnce({ token: 'session-one', expiresAt: 1_700_000_010 })
      .mockResolvedValueOnce({ token: 'session-two', expiresAt: 1_700_000_600 })
    const deps = dependencies({
      controlPlaneClient: {
        exchangeGitHubActionsToken: exchange,
        submitPublishRequest: jest.fn(async () => ({ requestId: 'req_1', status: 'queued' as const })),
        getPublishRequest: jest.fn(async () => ({
          request: { id: 'req_1', status: 'accepted' as const },
        })),
      },
    })

    await new PublishActionRunner(logger, deps as never).run()

    expect(exchange).toHaveBeenCalledTimes(2)
    expect(deps.idTokenProvider).toHaveBeenCalledTimes(2)
    expect(deps.controlPlaneClient.getPublishRequest).toHaveBeenCalledWith('session-two', 'req_1')
    expect(core.setSecret).toHaveBeenCalledWith('session-two')
  })

  it('stops when trusted-publisher OIDC exchange is rejected', async () => {
    const submit = jest.fn()
    const deps = dependencies({
      controlPlaneClient: {
        exchangeGitHubActionsToken: jest.fn(async () => {
          throw new ControlPlaneError('No trusted publisher matched.', 'OIDC_RULE_NOT_FOUND', 400)
        }),
        submitPublishRequest: submit,
        getPublishRequest: jest.fn(),
      },
    })

    await new PublishActionRunner(logger, deps as never).run()

    expect(submit).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('No trusted publisher matched.')
    expect(deps.summaryWriter.writeFailure).toHaveBeenCalledTimes(1)
  })

  it('fails the action when the server reports a failed terminal request', async () => {
    const deps = dependencies({
      controlPlaneClient: {
        exchangeGitHubActionsToken: jest.fn(async () => ({
          token: 'session-secret',
          expiresAt: 2_000_000_000,
        })),
        submitPublishRequest: jest.fn(async () => ({ requestId: 'req_1', status: 'failed' as const })),
        getPublishRequest: jest.fn(),
      },
    })

    await new PublishActionRunner(logger, deps as never).run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('finished with status "failed"'))
    expect(deps.summaryWriter.writeFailure).toHaveBeenCalledWith(
      expect.objectContaining({ request: { requestId: 'req_1', status: 'failed' } }),
    )
  })

  it('does not expose an ID-token acquisition error', async () => {
    const deps = dependencies({
      idTokenProvider: jest.fn(async () => {
        throw new Error('secret-bearing runtime detail')
      }),
    })

    await new PublishActionRunner(logger, deps as never).run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Unable to obtain a GitHub Actions OIDC token. Grant this job "id-token: write".',
    )
    expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('secret-bearing'))
  })
})
