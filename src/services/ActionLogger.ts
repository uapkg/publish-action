import { createLogger } from '@uapkg/log'

export interface ActionLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
}

export class UapkgActionLogger implements ActionLogger {
  private readonly logger = createLogger({ context: 'publish-action' })

  info(message: string): void {
    this.logger.info(message)
  }

  warn(message: string): void {
    this.logger.warn(message)
  }

  error(message: string): void {
    this.logger.error(message)
  }

  debug(message: string): void {
    this.logger.debug(message)
  }
}
