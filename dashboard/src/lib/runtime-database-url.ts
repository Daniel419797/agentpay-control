export function runtimeDatabaseUrl(connectionString: string, serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
  if (!serverless) return connectionString;

  try {
    const url = new URL(connectionString);
    const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");
    if (!isSupabasePooler || url.port !== "5432") return connectionString;

    // Supabase session mode (5432) pins one backend connection per client.
    // Vercel/serverless runtimes should use Supavisor transaction mode (6543)
    // so transient function instances do not exhaust the session pool.
    url.port = "6543";
    if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    return url.toString();
  } catch {
    return connectionString;
  }
}
