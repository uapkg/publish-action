export type ExistingRequestPolicy = 'create-new' | 'reuse-existing' | 'fail-if-existing'

export interface PublishActionInputs {
  readonly token: string
  readonly registryRepo: string
  readonly manifestPath: string
  readonly releaseTagInput?: string
  readonly existingRequestPolicy: ExistingRequestPolicy
}

export interface PublishMetadata {
  readonly packageName: string
  readonly packageVersion: string
  readonly packageSource: string
  readonly releaseTag: string
}

export interface RepositoryRef {
  readonly owner: string
  readonly name: string
  readonly fullName: string
}

export interface PublishIssueResult {
  readonly issueNumber: number
  readonly issueUrl: string
  readonly issueState: 'created' | 'existing'
}

export interface DiagnosticsReport {
  readonly errors: number
  readonly warnings: number
  readonly infos: number
  readonly formattedDiagnostics: readonly string[]
}

export interface PublishSuccessSummary {
  readonly metadata: PublishMetadata
  readonly registryRepo: string
  readonly existingRequestPolicy: ExistingRequestPolicy
  readonly issue: PublishIssueResult
  readonly diagnostics: DiagnosticsReport
}

export interface PublishFailureSummary {
  readonly metadata?: Partial<PublishMetadata>
  readonly registryRepo?: string
  readonly existingRequestPolicy?: ExistingRequestPolicy
  readonly diagnostics: DiagnosticsReport
}

export interface PublishIssueRequest {
  readonly registryRepo: RepositoryRef
  readonly existingRequestPolicy: ExistingRequestPolicy
  readonly packageName: string
  readonly packageVersion: string
  readonly packageSource: string
  readonly releaseTag: string
}

export interface ReleaseAssetVerificationRequest {
  readonly packageSource: RepositoryRef
  readonly releaseTag: string
  readonly packageName: string
  readonly packageVersion: string
}
