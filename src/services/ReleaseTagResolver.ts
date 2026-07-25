import { readFile } from 'node:fs/promises'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'

interface ReleaseEventPayload {
  readonly release?: {
    readonly tag_name?: string
  }
}

const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export class ReleaseTagResolver {
  async resolve(explicitReleaseTag: string | undefined, packageVersion: string): Promise<Result<string>> {
    const bag = new DiagnosticBag()

    if (explicitReleaseTag) {
      return this.validateTag(explicitReleaseTag, bag, 'input')
    }

    const eventTag = await this.readReleaseTagFromEventPayload(bag)
    if (eventTag) {
      return this.validateTag(eventTag, bag, 'release event')
    }

    const refType = process.env.GITHUB_REF_TYPE?.trim()
    const refName = process.env.GITHUB_REF_NAME?.trim()
    if (refType === 'tag' && refName) {
      return this.validateTag(refName, bag, 'tag ref')
    }

    if (SEMVER_PATTERN.test(packageVersion)) {
      return bag.toResult(`v${packageVersion}`)
    }

    bag.addError(
      'PUBLISH_ACTION_RELEASE_TAG_MISSING',
      'Unable to resolve a release tag from the input, workflow event, tag ref, or manifest version.',
      {
        releaseTagInputProvided: false,
        githubRefType: refType,
        githubRefName: refName,
      },
      'Set the action input "release-tag" explicitly.',
    )

    return bag.toFailure()
  }

  private validateTag(tag: string, bag: DiagnosticBag, source: string): Result<string> {
    const normalized = tag.trim()
    if (
      normalized.length === 0 ||
      normalized.length > 255 ||
      containsControlCharacter(normalized) ||
      normalized.startsWith('-')
    ) {
      bag.addError(
        'PUBLISH_ACTION_RELEASE_TAG_INVALID',
        `The release tag resolved from ${source} is invalid.`,
        { source },
        'Use a non-empty Git tag of at most 255 characters.',
      )
      return bag.toFailure()
    }
    return bag.toResult(normalized)
  }

  private async readReleaseTagFromEventPayload(bag: DiagnosticBag): Promise<string | undefined> {
    const eventPath = process.env.GITHUB_EVENT_PATH?.trim()
    if (!eventPath) {
      return undefined
    }

    let payloadRaw: string
    try {
      payloadRaw = await readFile(eventPath, 'utf8')
    } catch {
      bag.addWarning(
        'PUBLISH_ACTION_EVENT_PAYLOAD_READ_WARNING',
        'The GitHub event payload could not be read; release-tag resolution will use the remaining sources.',
        {},
      )
      return undefined
    }

    let payload: ReleaseEventPayload
    try {
      payload = JSON.parse(payloadRaw) as ReleaseEventPayload
    } catch {
      bag.addWarning(
        'PUBLISH_ACTION_EVENT_PAYLOAD_PARSE_WARNING',
        'The GitHub event payload was not valid JSON; release-tag resolution will use the remaining sources.',
        {},
      )
      return undefined
    }

    const releaseTag = payload.release?.tag_name?.trim()
    return releaseTag && releaseTag.length > 0 ? releaseTag : undefined
  }
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}
