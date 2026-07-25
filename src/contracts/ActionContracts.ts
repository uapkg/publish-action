export type RegistryRequestStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_pr_checks'
  | 'accepted'
  | 'failed'
  | 'timed_out'
  | 'finalization_failed'

export interface PublishActionInputs {
  readonly registryId: string
  readonly manifestPath: string
  readonly releaseTagInput?: string
  readonly assetName: string
  readonly detach: boolean
}

export interface PublishMetadata {
  readonly packageName: string
  readonly packageVersion: string
  readonly packageSource: string
  readonly manifestPath: string
  readonly releaseTag: string
}

export interface PublishManifestMetadata {
  readonly packageName: string
  readonly packageVersion: string
  readonly packageSource: string
  readonly manifestPath: string
}

export interface GitHubReleaseSource {
  readonly type: 'github_release'
  readonly repository: string
  readonly releaseTag: string
  readonly assetName: string
  readonly pathToManifest: string
}

export interface PublishRequestSubmission {
  readonly registryId: string
  readonly kind: 'publish_new_version'
  readonly payload: {
    readonly packageName: string
    readonly packageVersion: string
    readonly source: GitHubReleaseSource
  }
}

export interface OidcSession {
  readonly token: string
  readonly expiresAt: number
}

export interface PublishRequestResult {
  readonly requestId: string
  readonly status: RegistryRequestStatus
}

export interface RegistryRequestResult {
  readonly request: {
    readonly id: string
    readonly status: RegistryRequestStatus
  }
}

export interface DiagnosticsReport {
  readonly errors: number
  readonly warnings: number
  readonly infos: number
  readonly formattedDiagnostics: readonly string[]
}

export interface PublishSuccessSummary {
  readonly metadata: PublishMetadata
  readonly registryId: string
  readonly request: PublishRequestResult
  readonly detached: boolean
  readonly diagnostics: DiagnosticsReport
}

export interface PublishFailureSummary {
  readonly metadata?: Partial<PublishMetadata>
  readonly registryId?: string
  readonly request?: PublishRequestResult
  readonly diagnostics: DiagnosticsReport
}
