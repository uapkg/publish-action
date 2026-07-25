import { createHash } from 'node:crypto'
import * as core from '@actions/core'
import { DiagnosticBag, type Diagnostic } from '@uapkg/diagnostics'
import type {
  OidcSession,
  PublishActionInputs,
  PublishMetadata,
  PublishRequestResult,
  PublishRequestSubmission,
  RegistryRequestStatus,
} from '../contracts/ActionContracts.js'
import type { ActionLogger } from './ActionLogger.js'
import { ControlPlaneClient, ControlPlaneError } from './ControlPlaneClient.js'
import { DiagnosticReporter } from './DiagnosticReporter.js'
import { JobSummaryWriter } from './JobSummaryWriter.js'
import { PublishActionInputReader } from './PublishActionInputReader.js'
import { PublishMetadataReader } from './PublishMetadataReader.js'
import { ReleaseTagResolver } from './ReleaseTagResolver.js'

const TERMINAL_STATUSES = new Set<RegistryRequestStatus>(['accepted', 'failed', 'timed_out', 'finalization_failed'])
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_POLL_TIMEOUT_MS = 30 * 60 * 1_000
const SESSION_RENEWAL_WINDOW_SECONDS = 60

interface RunnerDependencies {
  readonly inputReader?: PublishActionInputReader
  readonly releaseTagResolver?: ReleaseTagResolver
  readonly metadataReader?: PublishMetadataReader
  readonly controlPlaneClient?: ControlPlaneClient
  readonly diagnosticReporter?: DiagnosticReporter
  readonly summaryWriter?: JobSummaryWriter
  readonly idTokenProvider?: () => Promise<string>
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly nowMilliseconds?: () => number
  readonly idempotencyKeyProvider?: (submission: PublishRequestSubmission) => string
  readonly pollIntervalMilliseconds?: number
  readonly pollTimeoutMilliseconds?: number
}

export class PublishActionRunner {
  private readonly inputReader: PublishActionInputReader
  private readonly releaseTagResolver: ReleaseTagResolver
  private readonly metadataReader: PublishMetadataReader
  private readonly controlPlaneClient: ControlPlaneClient
  private readonly diagnosticReporter: DiagnosticReporter
  private readonly summaryWriter: JobSummaryWriter
  private readonly idTokenProvider: () => Promise<string>
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly nowMilliseconds: () => number
  private readonly idempotencyKeyProvider: (submission: PublishRequestSubmission) => string
  private readonly pollIntervalMilliseconds: number
  private readonly pollTimeoutMilliseconds: number

  constructor(
    private readonly logger: ActionLogger,
    dependencies: RunnerDependencies = {},
  ) {
    this.inputReader = dependencies.inputReader ?? new PublishActionInputReader()
    this.releaseTagResolver = dependencies.releaseTagResolver ?? new ReleaseTagResolver()
    this.metadataReader = dependencies.metadataReader ?? new PublishMetadataReader()
    this.controlPlaneClient = dependencies.controlPlaneClient ?? new ControlPlaneClient()
    this.diagnosticReporter = dependencies.diagnosticReporter ?? new DiagnosticReporter(logger)
    this.summaryWriter = dependencies.summaryWriter ?? new JobSummaryWriter()
    this.idTokenProvider = dependencies.idTokenProvider ?? (() => core.getIDToken('uapkg'))
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)))
    this.nowMilliseconds = dependencies.nowMilliseconds ?? Date.now
    this.idempotencyKeyProvider = dependencies.idempotencyKeyProvider ?? createGitHubActionsIdempotencyKey
    this.pollIntervalMilliseconds = dependencies.pollIntervalMilliseconds ?? DEFAULT_POLL_INTERVAL_MS
    this.pollTimeoutMilliseconds = dependencies.pollTimeoutMilliseconds ?? DEFAULT_POLL_TIMEOUT_MS
  }

  async run(): Promise<void> {
    const diagnostics = new DiagnosticBag()

    const inputResult = this.inputReader.read()
    diagnostics.mergeArray(inputResult.diagnostics)
    if (!inputResult.ok) {
      await this.finishFailure(diagnostics.all())
      return
    }
    const actionInputs: PublishActionInputs = inputResult.value

    const manifestResult = await this.metadataReader.read(actionInputs.manifestPath)
    diagnostics.mergeArray(manifestResult.diagnostics)
    if (!manifestResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs)
      return
    }

    const releaseTagResult = await this.releaseTagResolver.resolve(
      actionInputs.releaseTagInput,
      manifestResult.value.packageVersion,
    )
    diagnostics.mergeArray(releaseTagResult.diagnostics)
    if (!releaseTagResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, manifestResult.value)
      return
    }

    const metadata: PublishMetadata = {
      ...manifestResult.value,
      releaseTag: releaseTagResult.value,
    }
    const submission = this.createSubmission(actionInputs, metadata)

    let session: OidcSession
    let requestResult: PublishRequestResult
    try {
      session = await this.createOidcSession()
      requestResult = await this.controlPlaneClient.submitPublishRequest(
        session.token,
        this.idempotencyKeyProvider(submission),
        submission,
      )
    } catch (error) {
      this.addControlPlaneFailure(diagnostics, error)
      await this.finishFailure(diagnostics.all(), actionInputs, metadata)
      return
    }

    this.setOutputs(metadata, requestResult)
    if (actionInputs.detach) {
      await this.finishSuccess(diagnostics.all(), actionInputs, metadata, requestResult, true)
      return
    }

    try {
      const terminal = await this.pollUntilTerminal(session, requestResult)
      this.setOutputs(metadata, terminal)
      if (terminal.status !== 'accepted') {
        diagnostics.addError(
          'PUBLISH_ACTION_REQUEST_FAILED',
          `UAPKG registry request ${terminal.requestId} finished with status "${terminal.status}".`,
          { requestId: terminal.requestId, status: terminal.status },
          'Review the UAPKG request status and workflow logs for the server-side policy or publishing failure.',
        )
        await this.finishFailure(diagnostics.all(), actionInputs, metadata, terminal)
        return
      }

      await this.finishSuccess(diagnostics.all(), actionInputs, metadata, terminal, false)
    } catch (error) {
      this.addControlPlaneFailure(diagnostics, error)
      await this.finishFailure(diagnostics.all(), actionInputs, metadata, requestResult)
    }
  }

  private createSubmission(inputs: PublishActionInputs, metadata: PublishMetadata): PublishRequestSubmission {
    return {
      registryId: inputs.registryId,
      kind: 'publish_new_version',
      payload: {
        packageName: metadata.packageName,
        packageVersion: metadata.packageVersion,
        source: {
          type: 'github_release',
          repository: metadata.packageSource,
          releaseTag: metadata.releaseTag,
          assetName: inputs.assetName,
          pathToManifest: metadata.manifestPath,
        },
      },
    }
  }

  private async createOidcSession(): Promise<OidcSession> {
    let idToken: string
    try {
      idToken = await this.idTokenProvider()
    } catch {
      throw new ControlPlaneError(
        'Unable to obtain a GitHub Actions OIDC token. Grant this job "id-token: write".',
        'GITHUB_OIDC_UNAVAILABLE',
      )
    }

    if (idToken.trim().length === 0) {
      throw new ControlPlaneError('GitHub returned an empty Actions OIDC token.', 'GITHUB_OIDC_UNAVAILABLE')
    }

    core.setSecret(idToken)
    const session = await this.controlPlaneClient.exchangeGitHubActionsToken(idToken)
    core.setSecret(session.token)
    return session
  }

  private async pollUntilTerminal(
    initialSession: OidcSession,
    initialRequest: PublishRequestResult,
  ): Promise<PublishRequestResult> {
    if (TERMINAL_STATUSES.has(initialRequest.status)) {
      return initialRequest
    }

    const startedAt = this.nowMilliseconds()
    let session = initialSession
    let current = initialRequest

    while (!TERMINAL_STATUSES.has(current.status)) {
      if (this.nowMilliseconds() - startedAt >= this.pollTimeoutMilliseconds) {
        throw new ControlPlaneError(
          `Timed out waiting for UAPKG registry request ${current.requestId}. The request may still be running.`,
          'POLL_TIMEOUT',
        )
      }

      await this.sleep(this.pollIntervalMilliseconds)
      if (this.sessionNeedsRenewal(session)) {
        session = await this.createOidcSession()
      }

      const statusResult = await this.controlPlaneClient.getPublishRequest(session.token, current.requestId)
      current = {
        requestId: statusResult.request.id,
        status: statusResult.request.status,
      }
      core.setOutput('request-status', current.status)
      this.logger.info(`UAPKG registry request ${current.requestId} is ${current.status}.`)
    }

    return current
  }

  private sessionNeedsRenewal(session: OidcSession): boolean {
    const expiresAtSeconds = session.expiresAt > 1_000_000_000_000 ? session.expiresAt / 1000 : session.expiresAt
    return expiresAtSeconds - this.nowMilliseconds() / 1000 <= SESSION_RENEWAL_WINDOW_SECONDS
  }

  private setOutputs(metadata: PublishMetadata, request: PublishRequestResult): void {
    core.setOutput('request-id', request.requestId)
    core.setOutput('request-status', request.status)
    core.setOutput('package-name', metadata.packageName)
    core.setOutput('package-version', metadata.packageVersion)
    core.setOutput('package-source', metadata.packageSource)
    core.setOutput('release-tag', metadata.releaseTag)
  }

  private addControlPlaneFailure(diagnostics: DiagnosticBag, error: unknown): void {
    if (error instanceof ControlPlaneError) {
      diagnostics.addError('PUBLISH_ACTION_CONTROL_PLANE_FAILURE', error.message, {
        code: error.code,
        status: error.status,
      })
      return
    }

    diagnostics.addError('PUBLISH_ACTION_CONTROL_PLANE_FAILURE', 'The UAPKG publish request failed unexpectedly.', {})
  }

  private async finishSuccess(
    diagnostics: readonly Diagnostic[],
    actionInputs: PublishActionInputs,
    metadata: PublishMetadata,
    request: PublishRequestResult,
    detached: boolean,
  ): Promise<void> {
    const report = this.diagnosticReporter.report(diagnostics)
    await this.summaryWriter.writeSuccess({
      metadata,
      registryId: actionInputs.registryId,
      request,
      detached,
      diagnostics: report,
    })
  }

  private async finishFailure(
    diagnostics: readonly Diagnostic[],
    actionInputs?: PublishActionInputs,
    metadata?: Partial<PublishMetadata>,
    request?: PublishRequestResult,
  ): Promise<void> {
    const report = this.diagnosticReporter.report(diagnostics)
    await this.summaryWriter.writeFailure({
      metadata,
      registryId: actionInputs?.registryId,
      request,
      diagnostics: report,
    })
    core.setFailed(this.getFailureMessage(diagnostics))
  }

  private getFailureMessage(diagnostics: readonly Diagnostic[]): string {
    return diagnostics.find((diagnostic) => diagnostic.level === 'error')?.message ?? 'uapkg publish request failed.'
  }
}

export function createGitHubActionsIdempotencyKey(
  submission: PublishRequestSubmission,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const runId = environment.GITHUB_RUN_ID?.trim()
  const job = environment.GITHUB_JOB?.trim()
  if (!runId || !job) {
    throw new ControlPlaneError(
      'GITHUB_RUN_ID and GITHUB_JOB are required to create a stable publish idempotency key.',
      'GITHUB_CONTEXT_UNAVAILABLE',
    )
  }

  const canonicalRequest = JSON.stringify({
    githubRunId: runId,
    githubJob: job,
    registryId: submission.registryId,
    kind: submission.kind,
    packageName: submission.payload.packageName,
    packageVersion: submission.payload.packageVersion,
    source: {
      type: submission.payload.source.type,
      repository: submission.payload.source.repository,
      releaseTag: submission.payload.source.releaseTag,
      assetName: submission.payload.source.assetName,
      pathToManifest: submission.payload.source.pathToManifest,
    },
  })
  return `gha-${createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')}`
}
