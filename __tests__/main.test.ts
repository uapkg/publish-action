import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

let runImplementation: () => Promise<void> = async () => undefined

class MockPublishActionRunner {
  async run(): Promise<void> {
    await runImplementation()
  }
}

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/services/PublishActionRunner.js', () => ({
  PublishActionRunner: MockPublishActionRunner
}))
jest.unstable_mockModule('../src/services/ActionLogger.js', () => ({
  UapkgActionLogger: class {
    info(): void {
      // no-op for tests
    }

    warn(): void {
      // no-op for tests
    }

    error(): void {
      // no-op for tests
    }

    debug(): void {
      // no-op for tests
    }
  }
}))

const { run } = await import('../src/main.js')

describe('main.ts', () => {
  afterEach(() => {
    runImplementation = async () => undefined
    jest.resetAllMocks()
  })

  it('invokes the runner', async () => {
    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('marks the action failed on unhandled errors', async () => {
    runImplementation = async () => {
      throw new Error('boom')
    }

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('boom')
  })
})
