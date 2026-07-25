import type {
  OidcSession,
  PublishRequestResult,
  PublishRequestSubmission,
  RegistryRequestResult,
  RegistryRequestStatus,
} from '../contracts/ActionContracts.js'

const CONTROL_PLANE_BASE_URL = 'https://api.uapkg.dev'
const OIDC_EXCHANGE_PATH = '/v1/github-user-app/oidc/github-actions/exchange'
const REGISTRY_REQUESTS_PATH = '/v1/registry-requests'
const MAXIMUM_RESPONSE_BYTES = 64 * 1024

const REQUEST_STATUSES = new Set<RegistryRequestStatus>([
  'queued',
  'running',
  'waiting_for_pr_checks',
  'accepted',
  'failed',
  'timed_out',
  'finalization_failed',
])

interface ErrorBody {
  readonly ok?: false
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
  }
}

export class ControlPlaneError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ControlPlaneError'
  }
}

export class ControlPlaneClient {
  constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  async exchangeGitHubActionsToken(idToken: string): Promise<OidcSession> {
    const value = await this.requestJson(OIDC_EXCHANGE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'github_actions',
        idToken,
        audience: 'uapkg',
      }),
    })

    if (
      !isRecord(value) ||
      value.ok !== true ||
      typeof value.token !== 'string' ||
      value.token.length === 0 ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt)
    ) {
      throw new ControlPlaneError('The UAPKG OIDC exchange returned an invalid response.', 'INVALID_RESPONSE')
    }

    return {
      token: value.token,
      expiresAt: value.expiresAt,
    }
  }

  async submitPublishRequest(
    sessionToken: string,
    idempotencyKey: string,
    submission: PublishRequestSubmission,
  ): Promise<PublishRequestResult> {
    const value = await this.requestJson(REGISTRY_REQUESTS_PATH, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': 'application/json',
        'x-uapkg-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(submission),
    })

    if (
      !isRecord(value) ||
      value.ok !== true ||
      typeof value.requestId !== 'string' ||
      value.requestId.length === 0 ||
      !isRegistryRequestStatus(value.status)
    ) {
      throw new ControlPlaneError('UAPKG returned an invalid publish-request response.', 'INVALID_RESPONSE')
    }

    return {
      requestId: value.requestId,
      status: value.status,
    }
  }

  async getPublishRequest(sessionToken: string, requestId: string): Promise<RegistryRequestResult> {
    const value = await this.requestJson(`${REGISTRY_REQUESTS_PATH}/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    })

    if (
      !isRecord(value) ||
      value.ok !== true ||
      !isRecord(value.request) ||
      typeof value.request.id !== 'string' ||
      value.request.id !== requestId ||
      !isRegistryRequestStatus(value.request.status)
    ) {
      throw new ControlPlaneError('UAPKG returned an invalid request-status response.', 'INVALID_RESPONSE')
    }

    return {
      request: {
        id: value.request.id,
        status: value.request.status,
      },
    }
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImplementation(`${CONTROL_PLANE_BASE_URL}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ControlPlaneError('Unable to reach the UAPKG control plane.', 'NETWORK_ERROR')
    }

    const value = await this.readResponse(response)
    if (!response.ok) {
      const error = isRecord(value) ? (value as ErrorBody).error : undefined
      const code = typeof error?.code === 'string' ? sanitizeServerText(error.code, 80) : `HTTP_${response.status}`
      const message =
        typeof error?.message === 'string'
          ? sanitizeServerText(error.message, 500)
          : `The UAPKG control plane rejected the request with HTTP ${response.status}.`
      throw new ControlPlaneError(message, code, response.status)
    }

    return value
  }

  private async readResponse(response: Response): Promise<unknown> {
    let body: string
    try {
      body = await response.text()
    } catch {
      throw new ControlPlaneError('The UAPKG control plane response could not be read.', 'INVALID_RESPONSE')
    }

    if (body.length === 0 || Buffer.byteLength(body, 'utf8') > MAXIMUM_RESPONSE_BYTES) {
      throw new ControlPlaneError('The UAPKG control plane returned an invalid response.', 'INVALID_RESPONSE')
    }

    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new ControlPlaneError('The UAPKG control plane returned invalid JSON.', 'INVALID_RESPONSE')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRegistryRequestStatus(value: unknown): value is RegistryRequestStatus {
  return typeof value === 'string' && REQUEST_STATUSES.has(value as RegistryRequestStatus)
}

function sanitizeServerText(value: string, maximumLength: number): string {
  const printable = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127 ? ' ' : character
    })
    .join('')
    .trim()
  return printable.slice(0, maximumLength) || 'The UAPKG control plane rejected the request.'
}
