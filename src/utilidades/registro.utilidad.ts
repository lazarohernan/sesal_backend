// Fastify uses pino internally, so we don't need morgan.
// Keep this simple logger for use in services/controllers that don't have access to Fastify's logger.
export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[INFO ] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[WARN ] ${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }
};
