import { ok } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET() { return ok(await db.chainNetwork.findMany({ where: { enabled: true }, orderBy: [{ testnet: "desc" }, { displayName: "asc" }] })); }
