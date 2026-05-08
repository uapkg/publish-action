import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { PublishActionRunner } = await import('../src/services/PublishActionRunner.js')

type RunnerDiagnostics = readonly {
  level: 'error' | 'warning' | 'info'
  code: string
  message: string
  data: object
}[]

const warningDiagnostics: RunnerDiagnostics = [
  {
    level: 'warning',
    code: 'WARN_ONLY',
    message: 'warning only',
    data: {},
  },
]

const errorDiagnostics: RunnerDiagnostics = [
  {
    level: 'error',
    code: 'FAILURE',
    message: 'failure message',
    data: {},
  },
]

describe('PublishActionRunner', () => {
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses fallback failure text when diagnostics contain no errors', async () => {
    const inputReader = {
      read: () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          token: 'token-value',
          registryRepo: 'uapkg/registry',
          manifestPath: 'uapkg.json',
          releaseTagInput: undefined,
          existingRequestPolicy: 'reuse-existing' as const,
        },
      }),
    }

    const releaseTagResolver = {
      resolve: async () => ({
        ok: false as const,
        diagnostics: warningDiagnostics,
      }),
    }

    const metadataReader = {
      read: async () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          packageName: 'my-package',
          packageVersion: '1.2.0',
          packageSource: 'uapkg/source-repo',
          releaseTag: 'v1.2.0',
        },
      }),
    }

    const repositoryRefParser = {
      parse: () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          owner: 'uapkg',
          name: 'registry',
          fullName: 'uapkg/registry',
        },
      }),
    }

    const githubClientFactory = {
      create: () => ({
        ok: true as const,
        diagnostics: [],
        value: {},
      }),
    }

    const diagnosticReporter = {
      report: jest.fn(() => ({
        errors: 0,
        warnings: 1,
        infos: 0,
        formattedDiagnostics: [],
      })),
    }

    const summaryWriter = {
      writeFailure: jest.fn(async () => undefined),
      writeSuccess: jest.fn(async () => undefined),
    }

    const runner = new PublishActionRunner(
      logger,
      inputReader as never,
      releaseTagResolver as never,
      metadataReader as never,
      repositoryRefParser as never,
      githubClientFactory as never,
      diagnosticReporter as never,
      summaryWriter as never,
    )

    await runner.run()

    expect(core.setFailed).toHaveBeenCalledWith('UAPKG publish request failed.')
    expect(summaryWriter.writeFailure).toHaveBeenCalledTimes(1)
  })

  it('fails when source package repository parsing fails', async () => {
    const inputReader = {
      read: () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          token: 'token-value',
          registryRepo: 'uapkg/registry',
          manifestPath: 'uapkg.json',
          releaseTagInput: undefined,
          existingRequestPolicy: 'reuse-existing' as const,
        },
      }),
    }

    const releaseTagResolver = {
      resolve: async () => ({
        ok: true as const,
        diagnostics: [],
        value: 'v1.2.0',
      }),
    }

    const metadataReader = {
      read: async () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          packageName: 'my-package',
          packageVersion: '1.2.0',
          packageSource: 'invalid source',
          releaseTag: 'v1.2.0',
        },
      }),
    }

    const repositoryRefParser = {
      parse: (value: string, fieldName: string) => {
        if (fieldName === 'package-source') {
          return {
            ok: false as const,
            diagnostics: errorDiagnostics,
          }
        }

        return {
          ok: true as const,
          diagnostics: [],
          value: { owner: 'uapkg', name: 'registry', fullName: value },
        }
      },
    }

    const githubClientFactory = {
      create: () => ({
        ok: true as const,
        diagnostics: [],
        value: {},
      }),
    }

    const diagnosticReporter = {
      report: jest.fn(() => ({
        errors: 1,
        warnings: 0,
        infos: 0,
        formattedDiagnostics: [],
      })),
    }

    const summaryWriter = {
      writeFailure: jest.fn(async () => undefined),
      writeSuccess: jest.fn(async () => undefined),
    }

    const runner = new PublishActionRunner(
      logger,
      inputReader as never,
      releaseTagResolver as never,
      metadataReader as never,
      repositoryRefParser as never,
      githubClientFactory as never,
      diagnosticReporter as never,
      summaryWriter as never,
    )

    await runner.run()

    expect(core.setFailed).toHaveBeenCalledWith('failure message')
    expect(summaryWriter.writeFailure).toHaveBeenCalledTimes(1)
  })

  it('fails when registry repository parsing fails', async () => {
    const inputReader = {
      read: () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          token: 'token-value',
          registryRepo: 'bad registry',
          manifestPath: 'uapkg.json',
          releaseTagInput: undefined,
          existingRequestPolicy: 'reuse-existing' as const,
        },
      }),
    }

    const releaseTagResolver = {
      resolve: async () => ({
        ok: true as const,
        diagnostics: [],
        value: 'v1.2.0',
      }),
    }

    const metadataReader = {
      read: async () => ({
        ok: true as const,
        diagnostics: [],
        value: {
          packageName: 'my-package',
          packageVersion: '1.2.0',
          packageSource: 'uapkg/source-repo',
          releaseTag: 'v1.2.0',
        },
      }),
    }

    const repositoryRefParser = {
      parse: (_value: string, fieldName: string) => {
        if (fieldName === 'registry-repo') {
          return {
            ok: false as const,
            diagnostics: errorDiagnostics,
          }
        }

        return {
          ok: true as const,
          diagnostics: [],
          value: {
            owner: 'uapkg',
            name: 'source-repo',
            fullName: 'uapkg/source-repo',
          },
        }
      },
    }

    const githubClientFactory = {
      create: () => ({
        ok: true as const,
        diagnostics: [],
        value: {},
      }),
    }

    const diagnosticReporter = {
      report: jest.fn(() => ({
        errors: 1,
        warnings: 0,
        infos: 0,
        formattedDiagnostics: [],
      })),
    }

    const summaryWriter = {
      writeFailure: jest.fn(async () => undefined),
      writeSuccess: jest.fn(async () => undefined),
    }

    const runner = new PublishActionRunner(
      logger,
      inputReader as never,
      releaseTagResolver as never,
      metadataReader as never,
      repositoryRefParser as never,
      githubClientFactory as never,
      diagnosticReporter as never,
      summaryWriter as never,
    )

    await runner.run()

    expect(core.setFailed).toHaveBeenCalledWith('failure message')
    expect(summaryWriter.writeFailure).toHaveBeenCalledTimes(1)
  })
})
