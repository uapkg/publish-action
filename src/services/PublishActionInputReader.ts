import * as core from '@actions/core'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type {
  ExistingRequestPolicy,
  PublishActionInputs
} from '../contracts/ActionContracts.js'

const DEFAULT_REGISTRY_REPO = 'uapkg/registry'
const DEFAULT_MANIFEST_PATH = 'uapkg.json'
const DEFAULT_EXISTING_REQUEST_POLICY: ExistingRequestPolicy = 'reuse-existing'

const ALLOWED_POLICIES = new Set<ExistingRequestPolicy>([
  'create-new',
  'reuse-existing',
  'fail-if-existing'
])

export class PublishActionInputReader {
  read(): Result<PublishActionInputs> {
    const bag = new DiagnosticBag()

    const token = core.getInput('token').trim()
    const registryRepo =
      core.getInput('registry-repo').trim() || DEFAULT_REGISTRY_REPO
    const manifestPath =
      core.getInput('manifest-path').trim() || DEFAULT_MANIFEST_PATH
    const releaseTagInput = core.getInput('release-tag').trim() || undefined

    const rawPolicy =
      core.getInput('existing-request-policy').trim() ||
      DEFAULT_EXISTING_REQUEST_POLICY

    if (token.length === 0) {
      bag.addError(
        'PUBLISH_ACTION_INPUT_REQUIRED',
        'Input "token" is required.',
        { input: 'token' },
        'Provide a token with permissions to create issues in the registry repository.'
      )
    }

    if (!ALLOWED_POLICIES.has(rawPolicy as ExistingRequestPolicy)) {
      bag.addError(
        'PUBLISH_ACTION_INPUT_INVALID',
        `Input "existing-request-policy" must be one of: create-new, reuse-existing, fail-if-existing. Received "${rawPolicy}".`,
        { input: 'existing-request-policy', value: rawPolicy }
      )
    }

    return bag.toResult({
      token,
      registryRepo,
      manifestPath,
      releaseTagInput,
      existingRequestPolicy: rawPolicy as ExistingRequestPolicy
    })
  }
}
