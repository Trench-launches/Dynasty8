import "server-only";
import pino from "pino";

/** Structured JSON logs. Known secret-bearing fields are redacted. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "dynasty8-api" },
  redact: {
    paths: [
      "headers.authorization",
      "headers.cookie",
      "*.apiKey",
      "*.api_key",
      "*.secret",
      "*.password",
      "url",
      "*.url",
    ],
    censor: "[redacted]",
  },
});
