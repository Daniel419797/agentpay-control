# AgentPay Control

AgentPay Control is a Hedera testnet operations console for policy-controlled agent payments. Operators authenticate with Supabase, verify a HashPack account through WalletConnect, create self-custody agents, review policy decisions, and record mirror-node-verified HBAR settlements with HashScan receipts.

The runtime does not generate simulated settlements or seeded business records. `npm run db:seed` only upserts verified network asset definitions.

## Local setup

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run db:deploy
npm.cmd run db:seed
npm.cmd run dev -- -p 3100
```

Open `http://localhost:3100/sign-in`.

Required configuration:

- `DATABASE_URL`: PostgreSQL connection string.
- `AUTH_SECRET`: at least 32 random characters.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: operator email/Google authentication.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: Reown project used by HashPack.
- `HEDERA_MIRROR_NODE_URL`: defaults to Hedera testnet mirror node.
- `FACILITATOR_URL`: required for autonomous managed x402 settlement.

Wallet-confirmed HBAR transfers do not require a platform private key. HashPack signs each transfer and the server validates payer, recipient, amount, consensus result, and transaction ID against the mirror node before recording it.

## Real workflow

1. Sign in through Google, email OTP, or magic link.
2. Connect HashPack and approve the ownership message.
3. Create an agent. Its account ID and balance are read from the verified wallet and mirror node.
4. Enter a real Hedera testnet recipient, HBAR amount, and purpose in the wallet menu.
5. Review and approve the transfer in HashPack.
6. Open the resulting HashScan receipt from Overview or Transactions.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The app deliberately refuses to create a settlement when no live facilitator is configured for an autonomous x402 request.
