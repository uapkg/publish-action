import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { PublishActionInputReader } = await import('../src/services/PublishActionInputReader.js')

describe('PublishActionInputReader', () => {
  const defaults: Record<string, string> = {
    'registry-id': '11111111-1111-4111-8111-111111111111',
    'manifest-path': '',
    'release-tag': '',
    asset: '',
    detach: '',
  }

  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => defaults[name] ?? '')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('reads safe defaults for optional inputs', () => {
    const result = new PublishActionInputReader().read()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({
      registryId: '11111111-1111-4111-8111-111111111111',
      manifestPath: 'uapkg.json',
      releaseTagInput: undefined,
      assetName: 'package.tgz',
      detach: false,
    })
  })

  it('reads explicit coordinates and detach', () => {
    core.getInput.mockImplementation(
      (name: string) =>
        ({
          ...defaults,
          'manifest-path': 'packages/example/uapkg.json',
          'release-tag': 'release-1',
          asset: 'example.tgz',
          detach: 'true',
        })[name] ?? '',
    )

    const result = new PublishActionInputReader().read()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.manifestPath).toBe('packages/example/uapkg.json')
    expect(result.value.releaseTagInput).toBe('release-1')
    expect(result.value.assetName).toBe('example.tgz')
    expect(result.value.detach).toBe(true)
  })

  it.each([
    ['registry-id', 'not-a-uuid'],
    ['asset', '../package.tgz'],
    ['asset', 'directory/package.tgz'],
    ['detach', 'yes'],
  ])('rejects invalid %s input', (input, value) => {
    core.getInput.mockImplementation((name: string) => (name === input ? value : (defaults[name] ?? '')))
    expect(new PublishActionInputReader().read().ok).toBe(false)
  })
})
