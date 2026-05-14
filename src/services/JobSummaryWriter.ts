import * as core from '@actions/core'
import type { PublishFailureSummary, PublishSuccessSummary } from '../contracts/ActionContracts.js'

export class JobSummaryWriter {
  async writeSuccess(summary: PublishSuccessSummary): Promise<void> {
    const diagnosticsBlock = this.renderDiagnostics(summary.diagnostics.formattedDiagnostics)

    const markdown = [
      '## uapkg Publish Action',
      '',
      '- Status: success',
      `- Issue State: ${summary.issue.issueState}`,
      `- Issue: [#${summary.issue.issueNumber}](${summary.issue.issueUrl})`,
      `- Registry Repo: ${summary.registryRepo}`,
      `- Existing Request Policy: ${summary.existingRequestPolicy}`,
      '',
      '### Package',
      `- Name: ${summary.metadata.packageName}`,
      `- Version: ${summary.metadata.packageVersion}`,
      `- Source: ${summary.metadata.packageSource}`,
      `- Ref: ${summary.metadata.releaseTag}`,
      '',
      '### Diagnostics',
      `- Errors: ${summary.diagnostics.errors}`,
      `- Warnings: ${summary.diagnostics.warnings}`,
      `- Info: ${summary.diagnostics.infos}`,
      diagnosticsBlock,
    ].join('\n')

    await this.append(markdown)
  }

  async writeFailure(summary: PublishFailureSummary): Promise<void> {
    const diagnosticsBlock = this.renderDiagnostics(summary.diagnostics.formattedDiagnostics)

    const markdown = [
      '## uapkg Publish Action',
      '',
      '- Status: failed',
      summary.registryRepo ? `- Registry Repo: ${summary.registryRepo}` : '',
      summary.existingRequestPolicy ? `- Existing Request Policy: ${summary.existingRequestPolicy}` : '',
      summary.metadata?.packageName ? `- Package Name: ${summary.metadata.packageName}` : '',
      summary.metadata?.packageVersion ? `- Package Version: ${summary.metadata.packageVersion}` : '',
      summary.metadata?.packageSource ? `- Package Source: ${summary.metadata.packageSource}` : '',
      summary.metadata?.releaseTag ? `- Release Tag: ${summary.metadata.releaseTag}` : '',
      '',
      '### Diagnostics',
      `- Errors: ${summary.diagnostics.errors}`,
      `- Warnings: ${summary.diagnostics.warnings}`,
      `- Info: ${summary.diagnostics.infos}`,
      diagnosticsBlock,
    ]
      .filter((line) => line.length > 0)
      .join('\n')

    await this.append(markdown)
  }

  private renderDiagnostics(formattedDiagnostics: readonly string[]): string {
    if (formattedDiagnostics.length === 0) {
      return '- None'
    }

    const lines = ['']

    for (const diagnostic of formattedDiagnostics) {
      lines.push('```text')
      lines.push(diagnostic)
      lines.push('```')
    }

    return lines.join('\n')
  }

  private async append(markdown: string): Promise<void> {
    try {
      await core.summary.addRaw(markdown).write({ overwrite: false })
    } catch (error) {
      core.warning(`Failed to write job summary: ${String(error)}`)
    }
  }
}
