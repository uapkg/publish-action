import * as core from '@actions/core'
import type { Diagnostic } from '@uapkg/diagnostics'
import { createFormatterRegistry, defaultFormatters } from '@uapkg/diagnostics-format'
import type { DiagnosticsReport } from '../contracts/ActionContracts.js'
import type { ActionLogger } from './ActionLogger.js'

export class DiagnosticReporter {
  private readonly formatter = createFormatterRegistry(defaultFormatters)

  constructor(private readonly logger: ActionLogger) {}

  report(diagnostics: readonly Diagnostic[]): DiagnosticsReport {
    const uniqueDiagnostics: Diagnostic[] = []
    const fingerprints = new Set<string>()

    for (const diagnostic of diagnostics) {
      if (diagnostic.emitPolicy === 'once' && diagnostic.emitFingerprint !== undefined) {
        if (fingerprints.has(diagnostic.emitFingerprint)) {
          continue
        }

        fingerprints.add(diagnostic.emitFingerprint)
      }

      uniqueDiagnostics.push(diagnostic)
    }

    let errors = 0
    let warnings = 0
    let infos = 0
    const formattedDiagnostics: string[] = []

    for (const diagnostic of uniqueDiagnostics) {
      const formatted = this.formatter.format(diagnostic)
      formattedDiagnostics.push(formatted)

      if (diagnostic.level === 'error') {
        errors += 1
        core.error(formatted)
      } else if (diagnostic.level === 'warning') {
        warnings += 1
        core.warning(formatted)
      } else {
        infos += 1
        core.info(formatted)
      }
    }

    if (errors > 0) {
      this.logger.error(`Collected ${errors} error diagnostic(s).`)
    }
    if (warnings > 0) {
      this.logger.warn(`Collected ${warnings} warning diagnostic(s).`)
    }
    if (infos > 0) {
      this.logger.info(`Collected ${infos} informational diagnostic(s).`)
    }

    return {
      errors,
      warnings,
      infos,
      formattedDiagnostics,
    }
  }
}
