import * as core from '@actions/core'
import { DiagnosticBag, type Result } from '@uapkg/diagnostics'
import type { PublishActionInputs } from '../contracts/ActionContracts.js'

const DEFAULT_MANIFEST_PATH = 'uapkg.json'
const DEFAULT_ASSET_NAME = 'package.tgz'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class PublishActionInputReader {
  read(): Result<PublishActionInputs> {
    const bag = new DiagnosticBag()

    const registryId = core.getInput('registry-id').trim().toLowerCase()
    const manifestPath = core.getInput('manifest-path').trim() || DEFAULT_MANIFEST_PATH
    const releaseTagInput = core.getInput('release-tag').trim() || undefined
    const assetName = core.getInput('asset').trim() || DEFAULT_ASSET_NAME
    const detachInput = core.getInput('detach').trim().toLowerCase()

    if (!UUID_PATTERN.test(registryId)) {
      bag.addError(
        'PUBLISH_ACTION_REGISTRY_ID_INVALID',
        'Input "registry-id" must be the canonical registry UUID.',
        { input: 'registry-id' },
        'Copy the registry ID from the UAPKG registry settings page.',
      )
    }

    if (
      assetName.length === 0 ||
      assetName.length > 255 ||
      assetName.includes('/') ||
      assetName.includes('\\') ||
      containsControlCharacter(assetName) ||
      assetName === '.' ||
      assetName === '..'
    ) {
      bag.addError(
        'PUBLISH_ACTION_ASSET_INVALID',
        'Input "asset" must be a single GitHub Release asset name.',
        { input: 'asset' },
        'Use an asset file name such as "package.tgz", without a path.',
      )
    }

    if (detachInput !== '' && detachInput !== 'true' && detachInput !== 'false') {
      bag.addError('PUBLISH_ACTION_DETACH_INVALID', 'Input "detach" must be either "true" or "false".', {
        input: 'detach',
      })
    }

    return bag.toResult({
      registryId,
      manifestPath,
      releaseTagInput,
      assetName,
      detach: detachInput === 'true',
    })
  }
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}
