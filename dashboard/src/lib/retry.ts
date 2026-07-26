function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
}

export async function retrySerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (errorCode(error) !== "P2034" || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw lastError;
}
