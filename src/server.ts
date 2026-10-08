import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info('Notification Service listening', { port: env.PORT, environment: env.NODE_ENV });
});

function shutdown(signal: string): void {
  logger.info('Shutdown requested', { signal });
  server.close((error) => {
    if (error) {
      logger.error('HTTP server shutdown failed', { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
