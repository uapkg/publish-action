import { jest } from '@jest/globals'

const loggerMethods = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

jest.unstable_mockModule('@uapkg/log', () => ({
  createLogger: jest.fn(() => loggerMethods),
}))

const { UapkgActionLogger } = await import('../src/services/ActionLogger.js')

describe('ActionLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('forwards all log methods to the shared uapkg logger', () => {
    const logger = new UapkgActionLogger()

    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')
    logger.debug('debug message')

    expect(loggerMethods.info).toHaveBeenCalledWith('info message')
    expect(loggerMethods.warn).toHaveBeenCalledWith('warn message')
    expect(loggerMethods.error).toHaveBeenCalledWith('error message')
    expect(loggerMethods.debug).toHaveBeenCalledWith('debug message')
  })
})
