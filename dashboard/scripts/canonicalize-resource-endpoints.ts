import { db } from "../src/lib/db";

function canonicalEndpoint(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`RESOURCE_ENDPOINT_PROTOCOL_INVALID:${value}`);
  if (url.username || url.password) throw new Error(`RESOURCE_ENDPOINT_CREDENTIALS_FORBIDDEN:${value}`);
  if (url.hash) throw new Error(`RESOURCE_ENDPOINT_FRAGMENT_FORBIDDEN:${value}`);
  return url.toString();
}

async function inspect() {
  const rows = await db.resourceListing.findMany({
    select: { id: true, providerId: true, endpoint: true },
    orderBy: { id: "asc" },
  });
  const normalized = rows.map((row) => ({ ...row, canonical: canonicalEndpoint(row.endpoint) }));
  const groups = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const group = groups.get(row.canonical) ?? [];
    group.push(row);
    groups.set(row.canonical, group);
  }
  const collisions = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([endpoint, group]) => ({ endpoint, rows: group.map(({ id, providerId, endpoint: stored }) => ({ id, providerId, stored })) }));
  const changes = normalized.filter((row) => row.endpoint !== row.canonical);
  return { rows, changes, collisions };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await inspect();
  if (before.collisions.length) {
    console.error(JSON.stringify({ ok: false, code: "RESOURCE_ENDPOINT_CANONICAL_COLLISION", collisions: before.collisions }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(JSON.stringify({ ok: before.changes.length === 0, scanned: before.rows.length, nonCanonical: before.changes.map((row) => ({ id: row.id, stored: row.endpoint, canonical: row.canonical })) }, null, 2));
    if (before.changes.length) process.exitCode = 1;
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('resource-endpoint-canonicalization', 0))`;
    const rows = await tx.resourceListing.findMany({ select: { id: true, endpoint: true }, orderBy: { id: "asc" } });
    const normalized = rows.map((row) => ({ ...row, canonical: canonicalEndpoint(row.endpoint) }));
    const unique = new Set<string>();
    for (const row of normalized) {
      if (unique.has(row.canonical)) throw new Error(`RESOURCE_ENDPOINT_CANONICAL_COLLISION:${row.canonical}`);
      unique.add(row.canonical);
    }
    for (const row of normalized) {
      if (row.endpoint !== row.canonical) await tx.resourceListing.update({ where: { id: row.id }, data: { endpoint: row.canonical } });
    }
  }, { isolationLevel: "Serializable" });

  const after = await inspect();
  if (after.collisions.length || after.changes.length) throw new Error("RESOURCE_ENDPOINT_CANONICALIZATION_INCOMPLETE");
  console.log(JSON.stringify({ ok: true, scanned: after.rows.length, canonicalized: before.changes.length }, null, 2));
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
