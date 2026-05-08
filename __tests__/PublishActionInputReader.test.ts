import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { PublishActionInputReader } = await import('../src/services/PublishActionInputReader.js')

describe('PublishActionInputReader', () => {
  const defaults = {
    token: 'token-value',
    'registry-repo': '',
    'manifest-path': '',
    'release-tag': '',
    'existing-request-policy': '',
  } as const

  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => defaults[name as keyof typeof defaults] ?? '')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('reads defaults when optional inputs are empty', () => {
    const reader = new PublishActionInputReader()
    const result = reader.read()

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.registryRepo).toBe('uapkg/registry')
    expect(result.value.manifestPath).toBe('uapkg.json')
    expect(result.value.existingRequestPolicy).toBe('reuse-existing')
  })

  it('fails for unsupported policy values', () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'existing-request-policy') {
        return 'unsupported'
      }

      return defaults[name as keyof typeof defaults] ?? ''
    })

    const reader = new PublishActionInputReader()
    const result = reader.read()

    expect(result.ok).toBe(false)
  })

  it('fails when token is missing', () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return ''
      }

      return defaults[name as keyof typeof defaults] ?? ''
    })

    const reader = new PublishActionInputReader()
    const result = reader.read()

    expect(result.ok).toBe(false)
  })
})
