import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://agentpay:agentpay@localhost:54329/agentpay?schema=public"
  }
});
