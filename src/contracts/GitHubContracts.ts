export interface GitHubReleaseAsset {
  readonly id: number
  readonly name: string
}

export interface GitHubReleaseResponse {
  readonly assets: readonly GitHubReleaseAsset[]
}

export interface GitHubAuthUser {
  readonly login: string
}

export interface GitHubIssueItem {
  readonly number: number
  readonly html_url: string
  readonly title: string
  readonly pull_request?: unknown
}

export interface GitHubIssueResponse {
  readonly number: number
  readonly html_url: string
}

export interface GitHubApi {
  readonly rest: {
    readonly users: {
      getAuthenticated(): Promise<{ data: GitHubAuthUser }>
    }
    readonly repos: {
      getReleaseByTag(params: { owner: string; repo: string; tag: string }): Promise<{ data: GitHubReleaseResponse }>
    }
    readonly issues: {
      create(params: {
        owner: string
        repo: string
        title: string
        body: string
      }): Promise<{ data: GitHubIssueResponse }>
    }
  }
  readonly search: {
    issuesAndPullRequests(params: {
      q: string
      per_page?: number
    }): Promise<{ data: { items: readonly GitHubIssueItem[] } }>
  }
}
