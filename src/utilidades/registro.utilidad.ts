import morgan from "morgan";

const stream = {
  write: (message: string) => {
    console.log(message.trim());
  }
};

const skip = () => process.env.NODE_ENV === "test";

export const httpLogger = morgan("combined", { stream, skip });

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
