type LogFields = Record<string, unknown>;

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { type: "UnknownError", message: String(error) };
  return {
    type: error.name,
    message: error.message,
    ...(process.env.APP_ENV === "production" ? {} : { stack: error.stack }),
  };
}

export function logError(event: string, error: unknown, fields: LogFields = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    service: "agentpay-control",
    event,
    ...fields,
    error: serializeError(error),
  }));
}
