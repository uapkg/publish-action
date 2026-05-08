import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type { RepositoryRef } from '../contracts/ActionContracts.js'

const OWNER_REPO_REGEX = /^[^/\s]+\/[^/\s]+$/

export class RepositoryRefParser {
  parse(value: string, fieldName: string): Result<RepositoryRef> {
    const bag = new DiagnosticBag()
    const trimmed = value.trim()

    if (!OWNER_REPO_REGEX.test(trimmed)) {
      bag.addError(
        'PUBLISH_ACTION_REPOSITORY_FORMAT',
        `Input "${fieldName}" must be in owner/repo form. Received "${value}".`,
        { fieldName, value },
        'Use a value like "uapkg/registry".',
      )
      return bag.toFailure()
    }

    const [owner, name] = trimmed.split('/')

    return bag.toResult({
      owner,
      name,
      fullName: trimmed,
    })
  }
}
