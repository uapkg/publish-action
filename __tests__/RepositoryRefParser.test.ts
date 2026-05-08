import { RepositoryRefParser } from '../src/services/RepositoryRefParser.js'

describe('RepositoryRefParser', () => {
  it('parses owner/repo values', () => {
    const parser = new RepositoryRefParser()
    const result = parser.parse('uapkg/registry', 'registry-repo')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value).toEqual({
      owner: 'uapkg',
      name: 'registry',
      fullName: 'uapkg/registry'
    })
  })

  it('returns diagnostics for invalid repository formats', () => {
    const parser = new RepositoryRefParser()
    const result = parser.parse('invalid repo', 'registry-repo')

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.diagnostics[0]?.code).toBe('PUBLISH_ACTION_REPOSITORY_FORMAT')
  })
})
