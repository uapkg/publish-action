import * as core from '@actions/core'
import { DiagnosticBag, type Diagnostic, type Result } from '@uapkg/diagnostics'
import type {
  PublishActionInputs,
  PublishIssueResult,
  PublishMetadata
} from '../contracts/ActionContracts.js'
import type { GitHubApi } from '../contracts/GitHubContracts.js'
import type { ActionLogger } from './ActionLogger.js'
import { DiagnosticReporter } from './DiagnosticReporter.js'
import { GitHubApiExecutor } from './GitHubApiExecutor.js'
import { GitHubClientFactory } from './GitHubClientFactory.js'
import { JobSummaryWriter } from './JobSummaryWriter.js'
import { PublishActionInputReader } from './PublishActionInputReader.js'
import { PublishMetadataReader } from './PublishMetadataReader.js'
import { RegistryIssueService } from './RegistryIssueService.js'
import { ReleaseAssetVerifier } from './ReleaseAssetVerifier.js'
import { ReleaseTagResolver } from './ReleaseTagResolver.js'
import { RepositoryRefParser } from './RepositoryRefParser.js'

export class PublishActionRunner {
  constructor(
    private readonly logger: ActionLogger,
    private readonly inputReader = new PublishActionInputReader(),
    private readonly releaseTagResolver = new ReleaseTagResolver(),
    private readonly metadataReader = new PublishMetadataReader(),
    private readonly repositoryRefParser = new RepositoryRefParser(),
    private readonly githubClientFactory = new GitHubClientFactory(),
    private readonly diagnosticReporter = new DiagnosticReporter(logger),
    private readonly summaryWriter = new JobSummaryWriter()
  ) {}

  async run(): Promise<void> {
    const diagnostics = new DiagnosticBag()
    let actionInputs: PublishActionInputs | undefined
    let publishMetadata: PublishMetadata | undefined

    const inputResult = this.inputReader.read()
    if (!inputResult.ok) {
      diagnostics.mergeArray(inputResult.diagnostics)
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    diagnostics.mergeArray(inputResult.diagnostics)
    actionInputs = inputResult.value

    const releaseTagResult = await this.releaseTagResolver.resolve(
      actionInputs.releaseTagInput
    )
    diagnostics.mergeArray(releaseTagResult.diagnostics)

    if (!releaseTagResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    const metadataResult = await this.metadataReader.read(
      actionInputs.manifestPath,
      releaseTagResult.value
    )
    diagnostics.mergeArray(metadataResult.diagnostics)

    if (!metadataResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    publishMetadata = metadataResult.value

    const githubClientResult = this.githubClientFactory.create(
      actionInputs.token
    )
    diagnostics.mergeArray(githubClientResult.diagnostics)

    if (!githubClientResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    const githubApi = githubClientResult.value

    const sourceRepoResult = this.repositoryRefParser.parse(
      publishMetadata.packageSource,
      'package-source'
    )
    diagnostics.mergeArray(sourceRepoResult.diagnostics)

    if (!sourceRepoResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    const registryRepoResult = this.repositoryRefParser.parse(
      actionInputs.registryRepo,
      'registry-repo'
    )
    diagnostics.mergeArray(registryRepoResult.diagnostics)

    if (!registryRepoResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    const apiExecutor = new GitHubApiExecutor(this.logger)

    const releaseAssetVerifier = new ReleaseAssetVerifier(
      githubApi,
      apiExecutor,
      this.logger
    )

    const releaseAssetResult = await releaseAssetVerifier.verify({
      packageSource: sourceRepoResult.value,
      releaseTag: publishMetadata.releaseTag,
      packageName: publishMetadata.packageName,
      packageVersion: publishMetadata.packageVersion
    })

    diagnostics.mergeArray(releaseAssetResult.diagnostics)

    if (!releaseAssetResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    const registryIssueService = new RegistryIssueService(
      githubApi,
      apiExecutor,
      this.logger
    )

    const issueResult = await registryIssueService.createOrReuse({
      registryRepo: registryRepoResult.value,
      existingRequestPolicy: actionInputs.existingRequestPolicy,
      packageName: publishMetadata.packageName,
      packageVersion: publishMetadata.packageVersion,
      packageSource: publishMetadata.packageSource,
      releaseTag: publishMetadata.releaseTag
    })

    diagnostics.mergeArray(issueResult.diagnostics)

    if (!issueResult.ok) {
      await this.finishFailure(diagnostics.all(), actionInputs, publishMetadata)
      return
    }

    this.setOutputs(publishMetadata, issueResult.value)

    const report = this.diagnosticReporter.report(diagnostics.all())

    await this.summaryWriter.writeSuccess({
      metadata: publishMetadata,
      registryRepo: actionInputs.registryRepo,
      existingRequestPolicy: actionInputs.existingRequestPolicy,
      issue: issueResult.value,
      diagnostics: report
    })
  }

  private setOutputs(
    metadata: PublishMetadata,
    issue: PublishIssueResult
  ): void {
    core.setOutput('issue-number', issue.issueNumber)
    core.setOutput('issue-url', issue.issueUrl)
    core.setOutput('issue-state', issue.issueState)
    core.setOutput('package-name', metadata.packageName)
    core.setOutput('package-version', metadata.packageVersion)
    core.setOutput('package-source', metadata.packageSource)
    core.setOutput('release-tag', metadata.releaseTag)
  }

  private async finishFailure(
    diagnostics: readonly Diagnostic[],
    actionInputs?: PublishActionInputs,
    metadata?: PublishMetadata
  ): Promise<void> {
    const report = this.diagnosticReporter.report(diagnostics)

    await this.summaryWriter.writeFailure({
      metadata,
      registryRepo: actionInputs?.registryRepo,
      existingRequestPolicy: actionInputs?.existingRequestPolicy,
      diagnostics: report
    })

    core.setFailed(this.getFailureMessage(diagnostics))
  }

  private getFailureMessage(diagnostics: readonly Diagnostic[]): string {
    const errorDiagnostic = diagnostics.find((d) => d.level === 'error')
    if (errorDiagnostic) {
      return errorDiagnostic.message
    }

    return 'UAPKG publish request failed.'
  }
}
