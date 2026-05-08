import { readFile } from 'node:fs/promises'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'

interface ReleaseEventPayload {
  readonly release?: {
    readonly tag_name?: string
  }
}

export class ReleaseTagResolver {
  async resolve(explicitReleaseTag?: string): Promise<Result<string>> {
    const bag = new DiagnosticBag()

    if (explicitReleaseTag && explicitReleaseTag.trim().length > 0) {
      return bag.toResult(explicitReleaseTag.trim())
    }

    const eventTag = await this.readReleaseTagFromEventPayload(bag)
    if (eventTag) {
      return bag.toResult(eventTag)
    }

    const refType = process.env.GITHUB_REF_TYPE?.trim()
    const refName = process.env.GITHUB_REF_NAME?.trim()

    if (refType === 'tag' && refName) {
      return bag.toResult(refName)
    }

    bag.addError(
      'PUBLISH_ACTION_RELEASE_TAG_MISSING',
      'Unable to resolve release tag. Provide "release-tag", trigger from a release event, or run from a tag ref.',
      {
        releaseTagInputProvided: false,
        githubRefType: refType,
        githubRefName: refName
      },
      'Set the action input "release-tag" explicitly when running outside release/tag contexts.'
    )

    return bag.toFailure()
  }

  private async readReleaseTagFromEventPayload(
    bag: DiagnosticBag
  ): Promise<string | undefined> {
    const eventPath = process.env.GITHUB_EVENT_PATH?.trim()
    if (!eventPath) {
      return undefined
    }

    let payloadRaw: string

    try {
      payloadRaw = await readFile(eventPath, 'utf8')
    } catch (error) {
      bag.addWarning(
        'PUBLISH_ACTION_EVENT_PAYLOAD_READ_WARNING',
        `Could not read GITHUB_EVENT_PATH "${eventPath}": ${String(error)}.`,
        { eventPath, reason: String(error) }
      )
      return undefined
    }

    let payload: ReleaseEventPayload

    try {
      payload = JSON.parse(payloadRaw) as ReleaseEventPayload
    } catch (error) {
      bag.addWarning(
        'PUBLISH_ACTION_EVENT_PAYLOAD_PARSE_WARNING',
        `Could not parse GITHUB_EVENT_PATH payload: ${String(error)}.`,
        { eventPath, reason: String(error) }
      )
      return undefined
    }

    const releaseTag = payload.release?.tag_name?.trim()
    return releaseTag && releaseTag.length > 0 ? releaseTag : undefined
  }
}
