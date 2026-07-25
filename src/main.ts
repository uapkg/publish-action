import * as core from '@actions/core'
import { createUnknownErrorDiagnostic, DiagnosticBag } from '@uapkg/diagnostics'
import { UapkgActionLogger } from './services/ActionLogger.js'
import { DiagnosticReporter } from './services/DiagnosticReporter.js'
import { JobSummaryWriter } from './services/JobSummaryWriter.js'
import { PublishActionRunner } from './services/PublishActionRunner.js'

/**
 * Entry point for the publish action runtime.
 */
export async function run(): Promise<void> {
  const logger = new UapkgActionLogger()
  const runner = new PublishActionRunner(logger)

  try {
    await runner.run()
  } catch {
    const message = 'The uapkg publish action failed unexpectedly.'
    const bag = new DiagnosticBag()
    bag.add(createUnknownErrorDiagnostic(message))

    const reporter = new DiagnosticReporter(logger)
    const report = reporter.report(bag.all())

    const summaryWriter = new JobSummaryWriter()
    await summaryWriter.writeFailure({ diagnostics: report })

    core.setFailed(message)
  }
}
