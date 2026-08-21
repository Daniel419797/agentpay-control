import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
  throw new Error("Payment identity isolation verification is restricted to a disposable local database.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

async function verifyDatabaseObjects() {
  const index = await pool.query<{ indexdef: string }>(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'PaymentAccount'
      AND indexname = 'PaymentAccount_network_canonical_accountId_key'
  `);
  if (index.rowCount !== 1 || !/CREATE UNIQUE INDEX/i.test(index.rows[0]!.indexdef)) {
    throw new Error("PAYMENT_IDENTITY_UNIQUE_INDEX_MISSING");
  }
  if (!index.rows[0]!.indexdef.includes("lower(\"accountId\")")) {
    throw new Error("PAYMENT_IDENTITY_EVM_CANONICALIZATION_MISSING");
  }

  const trigger = await pool.query<{ enabled: string; definition: string }>(`
    SELECT t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'PaymentAccount'
      AND t.tgname = 'PaymentAccount_identity_lock'
      AND NOT t.tgisinternal
  `);
  if (trigger.rowCount !== 1 || trigger.rows[0]!.enabled === "D") {
    throw new Error("PAYMENT_IDENTITY_GLOBAL_LOCK_TRIGGER_MISSING");
  }

  const lockFunction = await pool.query<{ definition: string }>(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'agentpay_lock_payment_identity'
  `);
  if (lockFunction.rowCount !== 1 || !lockFunction.rows[0]!.definition.includes("pg_advisory_xact_lock")) {
    throw new Error("PAYMENT_IDENTITY_GLOBAL_ADVISORY_LOCK_MISSING");
  }

  const duplicates = await pool.query(`
    SELECT 1
    FROM "PaymentAccount"
    GROUP BY
      "network",
      CASE WHEN "network" LIKE 'eip155:%' THEN lower("accountId") ELSE "accountId" END
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (duplicates.rowCount) throw new Error("PAYMENT_IDENTITY_DUPLICATES_PRESENT");
}

async function insertFixtures(client: Client) {
  const now = new Date();
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const agentA = randomUUID();
  const agentB = randomUUID();

  await client.query(
    `INSERT INTO "Organization" ("id", "name", "slug", "updatedAt") VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)`,
    [organizationA, "Identity isolation A", `identity-isolation-a-${organizationA}`, now, organizationB, "Identity isolation B", `identity-isolation-b-${organizationB}`],
  );
  await client.query(
    `INSERT INTO "Agent" ("id", "organizationId", "name", "status", "network", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', 'eip155:5042002', $4), ($5, $6, $7, 'ACTIVE', 'eip155:5042002', $4)`,
    [agentA, organizationA, "Isolation verifier A", now, agentB, organizationB, "Isolation verifier B"],
  );

  return { organizationA, organizationB, agentA, agentB };
}

async function verifyConcurrentDuplicateRejection() {
  const setup = new Client({ connectionString: databaseUrl });
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  await Promise.all([setup.connect(), first.connect(), second.connect()]);

  const fixtures = await insertFixtures(setup);
  const account = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  let secondSettled = false;

  try {
    await first.query("BEGIN");
    await first.query(
      `INSERT INTO "PaymentAccount" ("id", "agentId", "network", "accountId", "evmAddress", "custodyType", "signingMode", "status", "updatedAt") VALUES ($1, $2, 'eip155:5042002', $3, $3, 'SELF_CUSTODY', 'WALLET_CONFIRMATION', 'ACTIVE', now())`,
      [randomUUID(), fixtures.agentA, account.toUpperCase().replace("0X", "0x")],
    );

    await second.query("BEGIN");
    const competing = second.query(
      `INSERT INTO "PaymentAccount" ("id", "agentId", "network", "accountId", "evmAddress", "custodyType", "signingMode", "status", "updatedAt") VALUES ($1, $2, 'eip155:5042002', $3, $3, 'SELF_CUSTODY', 'WALLET_CONFIRMATION', 'ACTIVE', now())`,
      [randomUUID(), fixtures.agentB, account],
    ).then(
      () => ({ accepted: true as const }),
      (error: { code?: string }) => ({ accepted: false as const, code: error.code }),
    ).finally(() => { secondSettled = true; });

    await new Promise((resolve) => setTimeout(resolve, 150));
    if (secondSettled) throw new Error("PAYMENT_IDENTITY_CONCURRENT_CLAIM_DID_NOT_SERIALIZE");

    await first.query("COMMIT");
    const result = await competing;
    if (result.accepted || result.code !== "23505") {
      throw new Error("PAYMENT_IDENTITY_CONCURRENT_DUPLICATE_NOT_REJECTED");
    }
    await second.query("ROLLBACK");
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    await setup.query(`DELETE FROM "PaymentAccount" WHERE "agentId" = ANY($1::uuid[])`, [[fixtures.agentA, fixtures.agentB]]).catch(() => undefined);
    await setup.query(`DELETE FROM "Agent" WHERE "id" = ANY($1::uuid[])`, [[fixtures.agentA, fixtures.agentB]]).catch(() => undefined);
    await setup.query(`DELETE FROM "Organization" WHERE "id" = ANY($1::uuid[])`, [[fixtures.organizationA, fixtures.organizationB]]).catch(() => undefined);
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

async function main() {
  await verifyDatabaseObjects();
  await verifyConcurrentDuplicateRejection();
  console.log(JSON.stringify({
    canonicalUniqueIndex: true,
    globalAdvisoryLockTrigger: true,
    concurrentCrossOrganizationDuplicateRejected: true,
  }));
}

main()
  .finally(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });