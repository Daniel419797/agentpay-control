# Unified Production Deployment

**Updated:** 2026-09-10

## Topology

```text
                         Internet / agents / users
                                  |
                                  v
                       Vercel AgentPay control plane
                                  |
                                  +---- PostgreSQL
                                  |
               +------------------+------------------+
               |                  |                  |
               v                  v                  v
         Moove / Stripe      Masumi/Pyth/KERIA   unified facilitator
                                                      |
                               +----------------------+----------------+
                               |                      |                |
                             Hedera                  Arc            Cardano
                                                                       |
                                                             Cardano signer
                                                              /          \
                                                          Preprod       Mainnet
                                                                         |
                                                               external custody

Additional read/data dependencies: Blockfrost, x402 resource servers, Dune.
```

## Vercel control plane

Responsibilities include authentication, organizations/RBAC, agents/credentials, policy/approvals/reservations, payments, resources/marketplace, invoices, cards/fiat/cross-chain orchestration, automation, intelligence, audit, notifications, reconciliation, and administrative lifecycle operations.

It may hold server-side credentials for control-plane provider integrations such as Moove/Stripe when required. It must not hold Cardano payer private keys, Cardano managed test derivation secrets, or external Mainnet custody private keys.

## PostgreSQL

The system of record for organization, policy, payment, provider, audit, automation, invoice, and reconciliation state. Run forward migrations before application code requiring the new schema.

The Moove integration includes a raw-SQL-managed table; schema-introspection workflows must preserve it intentionally.

## Unified facilitator

The public facilitator mounts supported Hedera, Arc, and Cardano profiles. It exposes health/readiness/supported capability information and performs network-specific payment verification/settlement duties.

For Cardano it calls the signer, independently verifies returned CBOR, manages replay/settlement claims, submits through Blockfrost, and evaluates confirmation evidence.

## Cardano signer

A web-service gateway with isolated Preprod/Mainnet worker contexts. Relevant network-namespaced capabilities include health, managed identity/signing, and unsigned preparation.

Preprod can hold the test-only per-agent derivation secret. Mainnet can hold the external custody API capability. These credentials are separate from facilitator capabilities.

## Moove

Moove Receive is called by the control plane. Its API credential is bound to one AgentPay organization. The provider hosts checkout and reports payment-link status/settlement evidence; AgentPay reconciles that evidence before linked business state changes.

## Stripe cards/fiat

When configured, the control plane calls Stripe Issuing/Money Management APIs through the provider adapter and receives signed provider webhook events. Restricted keys and webhook secrets remain server-side.

## Masumi, Pyth, Veridian/KERIA

These are optional external integrations used for escrow, trust, pricing, or credential evidence. Each integration is enabled only with complete reviewed configuration.

## Blockfrost

Cardano signer uses Blockfrost for construction inputs; the facilitator uses Blockfrost for submission and confirmation evidence. Use network-correct project configuration.

## Dune

Dune consumes/publicly analyzes chain facts. It is outside the authorization/signing/settlement path and can be unavailable without preventing AgentPay from deciding payment truth.

## Environment ownership

Configuration should be placed according to least authority:

- application/session/database/provider-orchestration secrets -> control plane;
- network settlement capabilities -> facilitator;
- Cardano construction/signing/test derivation/external custody capability -> signer;
- managed Mainnet private keys -> external custody;
- public analytics credentials -> analytics tooling only when required.

Never duplicate high-value secrets across services merely for convenience.

## Deployment order

1. select exact source revision;
2. run CI/security gates;
3. verify backup and apply database migrations;
4. deploy Cardano signer and verify worker readiness;
5. deploy facilitator and verify rail/signer readiness;
6. deploy control plane with enabled provider configuration;
7. configure reconciliation/notification schedulers;
8. run `/api/v1/ready` plus service readiness;
9. execute low-value canaries for every enabled financial profile;
10. monitor before increasing limits or funding.

## Rollback

Keep previous compatible service/application releases available until the new release is verified. Database migrations are forward-oriented; rollback decisions must account for schema compatibility and never discard financial evidence or weaken identity/replay constraints.
