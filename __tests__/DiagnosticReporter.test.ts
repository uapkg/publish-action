import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { DiagnosticReporter } =
  await import('../src/services/DiagnosticReporter.js')

describe('DiagnosticReporter', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('formats diagnostics by severity and deduplicates once-only diagnostics', () => {
    const reporter = new DiagnosticReporter(logger)

    const diagnostics = [
      {
        level: 'error',
        code: 'UNKNOWN_ERROR',
        message: 'Hard failure',
        hint: 'Check logs',
        data: { reason: 'bad input' }
      },
      {
        level: 'warning',
        code: 'CONFIG_UNKNOWN_KEY',
        message: 'Unknown key',
        hint: 'Remove key',
        data: {
          path: 'foo',
          source: 'manifest'
        }
      },
      {
        level: 'info',
        code: 'DEPENDENCY_NOT_FOUND',
        message: 'Dependency not declared',
        data: { packageName: 'pkg' }
      },
      {
        level: 'warning',
        code: 'CONFIG_UNKNOWN_KEY',
        message: 'Duplicate warning',
        data: {
          path: 'foo',
          source: 'manifest'
        },
        emitPolicy: 'once',
        emitFingerprint: 'same-warning-fingerprint'
      },
      {
        level: 'warning',
        code: 'CONFIG_UNKNOWN_KEY',
        message: 'Duplicate warning',
        data: {
          path: 'foo',
          source: 'manifest'
        },
        emitPolicy: 'once',
        emitFingerprint: 'same-warning-fingerprint'
      }
    ] as const

    const report = reporter.report(diagnostics)

    expect(report.errors).toBe(1)
    expect(report.warnings).toBe(2)
    expect(report.infos).toBe(1)
    expect(report.formattedDiagnostics).toHaveLength(4)

    expect(core.error).toHaveBeenCalledTimes(1)
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(core.info).toHaveBeenCalledTimes(1)

    expect(logger.error).toHaveBeenCalledWith(
      'Collected 1 error diagnostic(s).'
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Collected 2 warning diagnostic(s).'
    )
    expect(logger.info).toHaveBeenCalledWith(
      'Collected 1 informational diagnostic(s).'
    )
  })

  it('returns an empty report when no diagnostics were produced', () => {
    const reporter = new DiagnosticReporter(logger)
    const report = reporter.report([])

    expect(report).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
      formattedDiagnostics: []
    })

    expect(core.error).not.toHaveBeenCalled()
    expect(core.warning).not.toHaveBeenCalled()
    expect(core.info).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })
})
