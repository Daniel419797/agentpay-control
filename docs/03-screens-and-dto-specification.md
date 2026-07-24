# AgentPay Control

## Screens and DTO Specification

**Version:** 1.0  
**Date:** 2026-07-21  
**Scope:** Complete MVP UX and versioned contracts; production extensions identified separately  

---

## 1. UX principles

1. **Operational clarity:** Show what happened, what is waiting, who must act, and whether funds moved.
2. **No invented data:** All metrics and records come from backend APIs. Loading, empty, error, stale, and unavailable states are explicit.
3. **Safe autonomy:** Policies and approval triggers are understandable before activation.
4. **Chain evidence:** Settled transactions expose the Hedera transaction ID, consensus status, network, and HashScan link.
5. **Testnet visibility:** A persistent environment indicator prevents testnet activity from being mistaken for real funds.
6. **Mobile workability:** Core transaction and approval actions work at 390 px. Data tables become record cards.
7. **Accessible status:** Text/icon labels accompany color; controls are keyboard operable; focus and async announcements are intentional.
8. **Secret hygiene:** Secrets are shown once, never placed in URLs, and never recoverable through the UI.

## 2. Information architecture

```text
/login
/onboarding
/app
  /overview
  /agents
    /new
    /:agentId
      /overview
      /policy
      /credentials
  /approvals
    /:approvalId
  /transactions
    /:transactionId
  /resources
    /:resourceId
  /provider
    /resources
  /audit
  /settings
    /organization
    /security
    /integrations       [Production]
```

### Desktop shell

- Fixed/collapsible left navigation.
- Header containing organization switcher (single organization in MVP), testnet badge, search placeholder, and user menu.
- Main content max-width appropriate to dense operational data.
- Global kill-switch banner when enabled.

### Mobile shell

- Compact header with menu trigger, page title, and testnet indicator.
- Navigation in an accessible drawer.
- Primary page action remains visible near the title or as a bottom-safe action where appropriate.
- No essential action is available only on hover.

## 3. Shared UI states

Every data-backed region must implement:

- **Initial loading:** layout-stable skeleton matching final geometry.
- **Refreshing:** existing data remains visible with a subtle updating indicator.
- **Empty:** explains why no records exist and presents the appropriate next action.
- **Filtered empty:** states that filters produced no results and offers clear-filters.
- **Recoverable error:** human message, request ID, and retry.
- **Unauthorized/forbidden:** no restricted data is rendered; provide safe navigation.
- **Stale:** display `Last updated` and a stale warning when balance/chain data exceeds threshold.
- **Offline:** preserve known data but disable unsafe mutations.
- **Success:** confirmation toast plus persistent resulting state; do not rely on toast alone.

## 4. Global components

### 4.1 Environment badge

- Label: `Hedera Testnet`.
- Visible in shell, account cards, transaction detail, and payment confirmation.
- Mainnet uses a materially different, high-salience treatment and step-up confirmation in production.

### 4.2 Money

- Render formatted display plus asset symbol, e.g. `0.250000 USDC` or `1.25 HBAR`.
- Preserve full exact value in accessible label or details when abbreviated.
- Never convert atomic amounts using floating point.

### 4.3 Status badge

Supported categories: neutral, info, warning, success, danger. Each includes text and optional icon.

### 4.4 HashScan link

- External-link indicator.
- Constructed by backend or validated client helper from network and transaction ID.
- Opens in a new tab with safe rel attributes.

### 4.5 Confirmation dialog

Used for pause, archive, credential revoke, policy publish, approval decision, and kill switch. It names the target and consequence. Destructive confirmation button receives initial focus only when appropriate; cancel is always available.

## 5. Screen specifications

### SCR-001: Sign in

**Route:** `/login`  
**MVP roles:** Public  

Purpose: authenticate an operator without implying wallet custody.

Content:

- Product name and concise value statement.
- Email input and `Continue with email` action.
- `Connect Hedera wallet` action with nonce-signature authentication.
- Link-identities guidance when the same user uses both methods.
- Privacy and testnet notice.
- Authentication error and resend state.

Acceptance:

- Valid submission does not reveal whether an unrelated email exists in production.
- Return URL is allowlisted to prevent open redirects.
- Authenticated users are redirected to the last safe application route.
- Managed-custody setup requires an email-linked identity; self-custody wallet setup requires a verified wallet identity. Linking both is supported and recommended.

### SCR-002: First-run onboarding

**Route:** `/onboarding`  
**MVP roles:** Authenticated user without organization  

Steps:

1. Organization name.
2. Confirm Hedera testnet mode and public-chain disclosure.
3. Choose email/wallet identity linkage as needed.
4. Create first agent or proceed to overview.

States: per-step validation, retryable provisioning error, completed redirect.

### SCR-003: Overview

**Route:** `/app/overview`  
**Roles:** Owner, Operator, Approver, Viewer  

Header:

- Title and short environment summary.
- Primary action: `Create agent` for authorized users.

Metric cards:

- Settled spend in selected window and asset.
- Active agents.
- Pending approvals.
- Failed/unknown transactions requiring attention.

Operational panels:

- Recent transactions.
- Pending approvals.
- Agent balances and low-balance warnings.
- Getting-started checklist until canonical flow completes.

Empty state: `Create your first agent to begin` with explanation of policy-controlled payments.

Mobile: metrics in two-column/one-column grid; recent items are cards, not a squeezed table.

### SCR-004: Agent list

**Route:** `/app/agents`  
**Roles:** all read; Owner/Operator mutate  

Columns/cards:

- Name and description.
- Status.
- Hedera account ID.
- Default asset balance and last sync.
- Today's settled/reserved spend versus daily limit.
- Active policy version.
- Last activity.

Controls:

- Search by name/account.
- Filter by status.
- Create agent.
- Row/card navigation.

Empty and filtered-empty states are distinct.

### SCR-005: Create agent

**Route:** `/app/agents/new`  
**Roles:** Owner, Operator  

Fields:

- Name (required, 2-80 characters).
- Description (optional, maximum 280 characters).
- Environment (locked to Hedera testnet in MVP).
- Default asset (HBAR; verified USDC option when enabled).
- Custody mode:
  - `Managed agent account` - platform provisions an isolated testnet key and can execute within policy.
  - `Self-custody wallet` - connect and prove control of a Hedera wallet; each payment requires wallet signing unless a bounded delegated session is configured.
- Self-custody account/wallet selector appears only for that mode.

Post-create states:

- `PROVISIONING` progress.
- Success with account ID, funding instructions, copy button, and HashScan account link.
- Provisioning error with retry that does not create duplicate accounts.
- Wallet connection canceled, wrong network/account, invalid proof, and delegated-session expiry states.

### SCR-006: Agent overview

**Route:** `/app/agents/:agentId/overview`  
**Roles:** all read; Owner/Operator mutate  

Header:

- Name, status, network badge.
- Actions: activate/pause, edit name, archive.

Panels:

- Account: account ID, asset balances, sync time, funding instructions.
- Spend: today settled, submitted/reserved, remaining budget.
- Active policy summary.
- Integration status: active API keys and last request.
- Recent transactions.

Warnings:

- Unfunded account.
- Stale balance.
- No policy.
- No active API key.
- Agent paused/error.
- Self-custody wallet currently requires human signature or delegated authorization, with an honest autonomy indicator.

### SCR-007: Agent policy editor

**Route:** `/app/agents/:agentId/policy`  
**Roles:** Owner, Operator  

MVP fields:

- Asset.
- Per-transaction maximum.
- Daily maximum (UTC).
- Over-limit action: Deny or Require approval.
- Merchant mode: any, allowlist only.
- Allowed hosts list.
- Denied hosts list.

Behavior:

- Display draft versus active version.
- Validate daily maximum is not lower than nonsensical configured constraints unless explicitly allowed.
- Normalize hosts; forbid schemes/paths in host-only fields.
- Preview example outcomes for below-limit, per-transaction breach, daily breach, and denied merchant.
- `Publish policy` requires confirmation and creates an immutable version.

No-policy state prevents agent activation or payment authorization.

### SCR-008: Agent credentials

**Route:** `/app/agents/:agentId/credentials`  
**Roles:** Owner, Operator  

List fields:

- Label.
- Prefix.
- Scopes.
- Created, expires, last used.
- Status.

Create dialog:

- Label.
- Expiration.
- Scopes (MVP default: `payments:create`, `agent:read`).

Secret-once panel:

- Plaintext API key.
- Copy action.
- Explicit `You will not be able to view this key again` warning.
- Checkbox/acknowledgment before closing is optional; secret is still never persisted client-side beyond the session response.

Revoke requires confirmation; UI updates immediately after success.

### SCR-009: Approval queue

**Route:** `/app/approvals`  
**Roles:** Approver read/decide; others according to read permission  

Filters:

- Status, agent, asset, date.

Record fields:

- Agent.
- Merchant/resource.
- Amount and asset.
- Trigger reason.
- Requested time and expiry countdown.
- Request reason.
- Status.

Primary action opens detail. Pending count is visible in navigation.

### SCR-010: Approval detail

**Route:** `/app/approvals/:approvalId`  
**Roles:** Approver; read-only for authorized viewers  

Sections:

- Decision summary and expiration.
- Agent identity and account.
- Resource URL/host and description.
- Exact destination, asset, and amount.
- Policy rule/reason codes and current spend context.
- Agent-provided purpose.
- Related transaction timeline.
- Audit metadata.

Actions:

- Approve with optional note.
- Reject with optional/required note based on policy (optional in MVP).

Confirmation states explicitly say approval authorizes only the displayed immutable payment. After a decision, actions disappear and the decision actor/time are shown.

### SCR-011: Transaction list

**Route:** `/app/transactions`  
**Roles:** all authorized roles  

Filters:

- Agent, status, asset, decision, date range, transaction ID search.

Desktop columns:

- Created time.
- Agent.
- Merchant/resource.
- Amount.
- Policy decision.
- Settlement status.
- Hedera transaction link when available.

Mobile cards group status, amount, agent, resource, time, and detail action.

Status copy distinguishes denied, approval pending, authorized, signing, submitted, unknown, settled, and failed.

### SCR-012: Transaction detail

**Route:** `/app/transactions/:transactionId`  
**Roles:** all authorized roles  

Summary:

- Business status and safe explanation.
- Amount/asset.
- Agent and merchant.
- Created/updated times.

Timeline events:

- Intent created.
- x402 challenge received.
- Policy evaluated.
- Reservation/approval.
- Signing.
- Facilitator verification/submission.
- Hedera confirmation.
- Resource fulfilled or failed.

Evidence panel:

- Network.
- Payer and payee.
- Hedera transaction ID.
- Consensus timestamp/status.
- HashScan link.
- Payment fingerprint (short form).

Recovery panel appears for actionable failure/unknown states with safe retry/reconcile guidance. Raw signed payloads are not displayed.

### SCR-013: Audit log

**Route:** `/app/audit`  
**Roles:** Owner, Viewer/Auditor; production fine-grained permission  

Filters: actor, action, target type, result, date. Rows/cards show timestamp, actor, action, target, result, and correlation ID. Detail drawer shows redacted metadata.

### SCR-014: Organization settings

**Route:** `/app/settings/organization`  
**Roles:** Owner  

- Organization name and immutable ID.
- Environment/network.
- Timezone (display; budget remains UTC in MVP).
- Global payment kill switch.

Kill switch activation requires typed/explicit confirmation and immediately creates an audit event. Deactivation also requires confirmation.

### SCR-015: Security settings

**Route:** `/app/settings/security`  
**Roles:** Owner  

MVP:

- Active sessions where supported.
- Security/audit links.
- Key-custody disclosure.
- `Testnet only` enforcement status.

Production additions: SSO, MFA/step-up, session revocation, IP policy, webhook secrets, signer/KMS status, mainnet enablement ceremony.

### SCR-016: Developer integration panel

**Location:** agent overview or credentials page  
**Roles:** Owner, Operator  

- Base API URL.
- Agent ID.
- Example environment variables with secret placeholder.
- cURL/TypeScript example for paid request initiation.
- Tabs/examples for REST, TypeScript SDK, `SKILL.md`, MCP, and LangChain.
- Result-state reference.
- Link to API schema and `SKILL.md` instructions.

Examples never embed a real API key after the one-time secret panel closes.

### SCR-017: Resource catalog

**Route:** `/app/resources`  
**Roles:** all authenticated roles  

Purpose: let agent operators discover and test priced x402 resources across all supported categories.

Filters/cards:

- Category: Market data, Files, AI inference, Web research.
- Provider, asset, price range, and availability.
- Resource name/description, provider, exact price options, settlement asset, and test action.
- `Use with agent` opens a bounded purchase form with agent, purpose, and maximum amount.

States include no providers, category empty, provider unavailable, unsupported asset, and price/challenge changed. The catalog is discovery metadata; the actual x402 challenge remains authoritative.

### SCR-018: Resource/provider detail

**Route:** `/app/resources/:resourceId`  
**Roles:** all authenticated roles  

- Resource description, category, provider identity, endpoint, availability, and supported assets.
- Price/options with explicit `price may be confirmed by x402 challenge` copy.
- Example REST/SDK/MCP/LangChain usage.
- Recent purchases for the current organization.
- Provider settlement account and public-chain disclosure where appropriate.

### SCR-019: Provider resource management

**Route:** `/app/provider/resources`  
**MVP:** reference-provider configuration/read-only status; **Production:** external provider self-service  
**Roles:** Provider Admin/Owner  

- Create/register resource, category, description, adapter/endpoint, price options, and settlement account.
- Prove control of settlement account.
- Activate, pause, and version a listing.
- View paid access, settlement totals, failures, and reconciliation status.
- MVP may seed the four reference resources through configuration while exposing the resulting status here.

## 6. Screen permissions matrix

| Screen/action | Owner | Operator | Approver | Viewer |
|---|---:|---:|---:|---:|
| View overview/agents/transactions | Yes | Yes | Yes | Yes |
| Create/edit/pause agent | Yes | Yes | No | No |
| Archive agent | Yes | Yes | No | No |
| Publish policy | Yes | Yes | No | No |
| Create/revoke agent credential | Yes | Yes | No | No |
| View approvals | Yes | Yes | Yes | Configurable read |
| Approve/reject | If Approver role | If Approver role | Yes | No |
| View audit | Yes | Configurable | Configurable | Yes if Auditor |
| Toggle global kill switch | Yes | No | No | No |
| Browse/use resource catalog | Yes | Yes | Yes | Yes |
| Manage provider listings | If Provider Admin | If Provider Admin | No | Read only |

The backend enforces permissions; hiding an action in the UI is not authorization.

## 7. DTO conventions

### 7.1 Primitive aliases

```ts
type Id = string;                 // UUID/ULID, opaque to clients
type IsoDateTime = string;        // ISO 8601 UTC
type Cursor = string;             // opaque signed/encoded cursor
type AtomicAmount = string;       // regex: ^[0-9]+$, no sign/decimal
type HederaAccountId = string;    // validated native/EVM-supported representation
type HederaTransactionId = string;
type Url = string;
```

### 7.2 Common DTOs

```ts
type AssetDto = {
  id: Id;
  network: "hedera:testnet" | "hedera:mainnet";
  type: "NATIVE" | "TOKEN";
  hederaTokenId: string | null;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
};

type MoneyDto = {
  asset: AssetDto;
  atomicAmount: AtomicAmount;
  displayAmount: string; // server-formatted convenience, never used for math
};

type PageDto<T> = {
  items: T[];
  nextCursor: Cursor | null;
};

type ActorDto = {
  type: "USER" | "AGENT" | "SYSTEM" | "SERVICE";
  id: Id | null;
  displayName: string;
};
```

### 7.3 Problem details

```ts
type ProblemDetailsDto = {
  type: Url;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  requestId: string;
  errors?: Array<{
    field?: string;
    code: string;
    message?: string;
  }>;
  retryable?: boolean;
  retryAfterSeconds?: number;
};
```

Stable MVP error codes:

- `AUTHENTICATION_REQUIRED`
- `PERMISSION_DENIED`
- `RESOURCE_NOT_FOUND`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_CONFLICT`
- `AGENT_NOT_ACTIVE`
- `ORGANIZATION_KILL_SWITCH_ACTIVE`
- `PAYMENT_CHALLENGE_INVALID`
- `PAYMENT_OPTION_UNSUPPORTED`
- `PAYMENT_POLICY_DENIED`
- `PAYMENT_APPROVAL_REQUIRED`
- `PAYMENT_INSUFFICIENT_BALANCE`
- `PAYMENT_ALREADY_PROCESSED`
- `PAYMENT_SUBMISSION_UNKNOWN`
- `FACILITATOR_UNAVAILABLE`
- `RATE_LIMITED`

## 8. Domain DTOs

### 8.1 Organization

```ts
type OrganizationDto = {
  id: Id;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  environmentMode: "TESTNET_ONLY" | "MAINNET_ENABLED";
  killSwitchEnabled: boolean;
  timezone: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type UpdateOrganizationRequest = {
  name?: string;
  timezone?: string;
};

type SetKillSwitchRequest = {
  enabled: boolean;
  reason: string;
};
```

### 8.2 Agent

```ts
type AgentStatus = "PROVISIONING" | "ACTIVE" | "PAUSED" | "ERROR" | "ARCHIVED";

type AgentSummaryDto = {
  id: Id;
  name: string;
  description: string | null;
  status: AgentStatus;
  network: "hedera:testnet" | "hedera:mainnet";
  accountId: HederaAccountId | null;
  defaultAsset: AssetDto;
  defaultBalance: MoneyDto | null;
  balanceAsOf: IsoDateTime | null;
  spendToday: MoneyDto;
  reservedToday: MoneyDto;
  dailyLimit: MoneyDto | null;
  policyVersion: number | null;
  lastActivityAt: IsoDateTime | null;
};

type AgentDetailDto = AgentSummaryDto & {
  organizationId: Id;
  paymentAccount: PaymentAccountDto | null;
  effectivePolicy: PolicyVersionDto | null;
  activeCredentialCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type CreateAgentRequest = {
  name: string;
  description?: string;
  network: "hedera:testnet"; // server rejects mainnet in MVP
  defaultAssetId: Id;
  custodyMode: "MANAGED" | "SELF_CUSTODY";
  managed?: {
    provisionNew: true;
  };
  selfCustody?: {
    accountId: HederaAccountId;
    walletProvider: "HASHPACK" | "OTHER_SUPPORTED";
    ownershipProofId: Id;
    delegationId?: Id;
  };
};

type CreateAgentResponse = {
  agent: AgentDetailDto;
  provisioningOperationId: Id;
};

type UpdateAgentRequest = {
  name?: string;
  description?: string | null;
};

type ChangeAgentStatusRequest = {
  action: "ACTIVATE" | "PAUSE" | "ARCHIVE";
  reason?: string;
};
```

### 8.3 Payment account and balance

```ts
type PaymentAccountDto = {
  id: Id;
  network: "hedera:testnet" | "hedera:mainnet";
  accountId: HederaAccountId;
  evmAddress: string | null;
  publicKey: string;
  custodyType: "PLATFORM_MANAGED_TESTNET" | "KMS" | "SELF_CUSTODY" | "EXTERNAL_DELEGATED";
  signingMode: "AUTONOMOUS_MANAGED" | "WALLET_CONFIRMATION" | "BOUNDED_DELEGATION";
  delegationExpiresAt: IsoDateTime | null;
  status: "PROVISIONING" | "ACTIVE" | "LOCKED" | "ERROR";
  hashScanUrl: Url;
  balances: BalanceDto[];
  syncedAt: IsoDateTime | null;
};

type BalanceDto = {
  money: MoneyDto;
  spendableAtomic: AtomicAmount;
  source: "HEDERA_SDK" | "MIRROR_NODE" | "CACHE";
  asOf: IsoDateTime;
  stale: boolean;
};
```

### 8.3A Wallet identity and custody

```ts
type CreateWalletChallengeRequest = {
  accountId: HederaAccountId;
  purpose: "LOGIN" | "LINK_IDENTITY" | "CONNECT_AGENT_ACCOUNT";
};

type WalletChallengeDto = {
  id: Id;
  accountId: HederaAccountId;
  network: "hedera:testnet";
  message: string;
  expiresAt: IsoDateTime;
};

type VerifyWalletChallengeRequest = {
  challengeId: Id;
  signedPayload: string;
  walletProvider: string;
};

type WalletIdentityDto = {
  id: Id;
  accountId: HederaAccountId;
  network: "hedera:testnet" | "hedera:mainnet";
  verifiedAt: IsoDateTime;
  walletProvider: string;
};

type DelegatedSignerGrantDto = {
  id: Id;
  accountId: HederaAccountId;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  allowedAssetIds: Id[];
  maxPerTransactionAtomic: AtomicAmount;
  allowedHosts: string[];
  expiresAt: IsoDateTime;
};
```

### 8.4 Policy

```ts
type OverLimitAction = "DENY" | "REQUIRE_APPROVAL";

type PolicyRuleSetDto = {
  assetId: Id;
  perTransactionLimitAtomic: AtomicAmount;
  dailyLimitAtomic: AtomicAmount;
  overLimitAction: OverLimitAction;
  merchantMode: "ANY" | "ALLOWLIST_ONLY";
  allowedHosts: string[];
  deniedHosts: string[];
};

type PolicyVersionDto = {
  id: Id;
  policyId: Id;
  agentId: Id;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  rules: PolicyRuleSetDto;
  createdBy: ActorDto;
  createdAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
};

type SavePolicyDraftRequest = {
  expectedVersion?: number;
  rules: PolicyRuleSetDto;
};

type PublishPolicyRequest = {
  draftVersionId: Id;
  changeNote?: string;
};

type PolicyPreviewRequest = {
  resourceUrl: Url;
  assetId: Id;
  amountAtomic: AtomicAmount;
};

type PolicyDecisionDto = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  reasonCodes: string[];
  policyVersionId: Id;
  evaluatedAt: IsoDateTime;
  spendBeforeAtomic: AtomicAmount;
  reservedBeforeAtomic: AtomicAmount;
  projectedSpendAtomic: AtomicAmount;
};
```

Reason codes include:

- `PLATFORM_RULE_DENY`
- `KILL_SWITCH_ACTIVE`
- `AGENT_INACTIVE`
- `NETWORK_UNSUPPORTED`
- `ASSET_UNSUPPORTED`
- `CHALLENGE_EXPIRED`
- `MERCHANT_DENIED`
- `MERCHANT_NOT_ALLOWED`
- `INSUFFICIENT_BALANCE`
- `PER_TRANSACTION_LIMIT_EXCEEDED`
- `DAILY_LIMIT_EXCEEDED`
- `WITHIN_POLICY`
- `APPROVAL_OVERRIDE_VALID`

### 8.5 Agent credential

```ts
type AgentCredentialDto = {
  id: Id;
  agentId: Id;
  label: string;
  prefix: string;
  scopes: Array<"agent:read" | "payments:create">;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: IsoDateTime | null;
  lastUsedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
};

type CreateAgentCredentialRequest = {
  label: string;
  scopes: Array<"agent:read" | "payments:create">;
  expiresAt?: IsoDateTime;
};

type CreateAgentCredentialResponse = {
  credential: AgentCredentialDto;
  secret: string; // returned exactly once
};
```

### 8.6 Paid request and payment intent

```ts
type InitiatePaidRequestRequest = {
  resource: {
    url: Url;
    method: "GET" | "POST";
    headers?: Record<string, string>; // strict allowlist; auth header handling restricted
    bodyBase64?: string;              // MVP may restrict to GET
  };
  purpose?: string;
  constraints?: {
    maxAmount: {
      assetId: Id;
      atomicAmount: AtomicAmount;
    };
    validUntil?: IsoDateTime;
  };
};

type PaymentIntentStatus =
  | "CREATED"
  | "QUOTED"
  | "DENIED"
  | "APPROVAL_PENDING"
  | "REJECTED"
  | "EXPIRED"
  | "AUTHORIZED"
  | "SIGNING"
  | "SUBMITTED"
  | "SUBMISSION_UNKNOWN"
  | "SETTLED"
  | "SETTLEMENT_FAILED"
  | "FAILED_BEFORE_SUBMISSION"
  | "CANCELED";

type PaymentQuoteDto = {
  id: Id;
  x402Version: number;
  scheme: "exact";
  network: string;
  resourceUrl: Url;
  resourceDescription: string | null;
  merchantHost: string;
  payToAccountId: HederaAccountId;
  amount: MoneyDto;
  validUntil: IsoDateTime;
  fingerprint: string;
};

type PaymentIntentDto = {
  id: Id;
  organizationId: Id;
  agent: { id: Id; name: string };
  status: PaymentIntentStatus;
  purpose: string | null;
  resourceUrl: Url;
  merchantHost: string;
  quote: PaymentQuoteDto | null;
  policyDecision: PolicyDecisionDto | null;
  approvalId: Id | null;
  settlement: SettlementDto | null;
  resourceResult?: {
    contentType: string;
    bodyBase64?: string; // only in synchronous agent response, not list/detail by default
    bodyStored: boolean;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type InitiatePaidRequestResponse = {
  intent: PaymentIntentDto;
  outcome:
    | "RESOURCE_FREE"
    | "PAYMENT_SETTLED"
    | "APPROVAL_REQUIRED"
    | "PAYMENT_DENIED"
    | "PAYMENT_PENDING"
    | "PAYMENT_FAILED";
  resource?: {
    status: number;
    contentType: string;
    bodyBase64: string;
  };
};
```

The `Idempotency-Key` header is mandatory for `POST /agents/:agentId/paid-requests`. Reusing a key with a different canonical request returns `409 IDEMPOTENCY_CONFLICT`.

### 8.7 Approval

```ts
type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELED" | "CONSUMED";

type ApprovalRequestDto = {
  id: Id;
  organizationId: Id;
  paymentIntentId: Id;
  agent: { id: Id; name: string; accountId: HederaAccountId };
  status: ApprovalStatus;
  quote: PaymentQuoteDto;
  reasonCodes: string[];
  requestPurpose: string | null;
  spendContext: {
    settledToday: MoneyDto;
    reservedToday: MoneyDto;
    dailyLimit: MoneyDto;
  };
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  decidedBy: ActorDto | null;
  decisionNote: string | null;
};

type DecideApprovalRequest = {
  decision: "APPROVE" | "REJECT";
  note?: string;
  expectedStatus: "PENDING";
};

type DecideApprovalResponse = {
  approval: ApprovalRequestDto;
  paymentIntent: PaymentIntentDto;
};
```

Approval decision requests require an `Idempotency-Key`. Approval execution is server-controlled; clients do not receive a reusable raw authorization token.

### 8.8 Settlement and transaction

```ts
type SettlementDto = {
  id: Id;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";
  network: "hedera:testnet" | "hedera:mainnet";
  transactionId: HederaTransactionId | null;
  consensusTimestamp: string | null;
  payerAccountId: HederaAccountId;
  payeeAccountId: HederaAccountId;
  amount: MoneyDto;
  resultCode: string | null;
  hashScanUrl: Url | null;
  submittedAt: IsoDateTime | null;
  confirmedAt: IsoDateTime | null;
};

type TransactionSummaryDto = {
  id: Id; // payment intent ID used as business transaction ID
  createdAt: IsoDateTime;
  agent: { id: Id; name: string };
  merchantHost: string;
  resourceDescription: string | null;
  amount: MoneyDto | null;
  policyDecision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | null;
  status: PaymentIntentStatus;
  hederaTransactionId: HederaTransactionId | null;
  hashScanUrl: Url | null;
};

type TransactionDetailDto = PaymentIntentDto & {
  attempts: PaymentAttemptDto[];
  timeline: TransactionEventDto[];
};

type PaymentAttemptDto = {
  id: Id;
  attemptNumber: number;
  status: "STARTED" | "SIGNED" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "UNKNOWN";
  facilitatorRequestId: string | null;
  signatureFingerprint: string | null;
  errorCode: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type TransactionEventDto = {
  id: Id;
  type: string;
  title: string;
  description: string | null;
  result: "INFO" | "SUCCESS" | "WARNING" | "FAILURE";
  actor: ActorDto;
  occurredAt: IsoDateTime;
  metadata: Record<string, string | number | boolean | null>;
};
```

### 8.9 Overview

```ts
type OverviewDto = {
  window: { from: IsoDateTime; to: IsoDateTime };
  selectedAsset: AssetDto;
  metrics: {
    settledSpend: MoneyDto;
    activeAgents: number;
    pendingApprovals: number;
    transactionsNeedingAttention: number;
  };
  recentTransactions: TransactionSummaryDto[];
  pendingApprovals: ApprovalRequestDto[];
  agentBalances: AgentSummaryDto[];
  onboarding: {
    agentCreated: boolean;
    accountFunded: boolean;
    policyPublished: boolean;
    credentialCreated: boolean;
    firstPaymentSettled: boolean;
  };
  generatedAt: IsoDateTime;
};
```

### 8.10 Audit

```ts
type AuditEventDto = {
  id: Id;
  organizationId: Id;
  actor: ActorDto;
  action: string;
  target: { type: string; id: Id | null; displayName?: string };
  result: "SUCCESS" | "FAILURE" | "DENIED";
  requestId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: IsoDateTime;
};
```

### 8.11 Resource providers and listings

```ts
type ResourceCategory = "MARKET_DATA" | "FILE" | "AI_INFERENCE" | "WEB_RESEARCH";

type ResourceProviderDto = {
  id: Id;
  name: string;
  status: "ACTIVE" | "PAUSED" | "UNAVAILABLE";
  settlementAccountId: HederaAccountId;
  settlementAccountVerified: boolean;
  createdAt: IsoDateTime;
};

type ResourcePriceDto = {
  asset: AssetDto;
  atomicAmount: AtomicAmount;
  displayAmount: string;
  scheme: "exact";
};

type ResourceListingDto = {
  id: Id;
  provider: ResourceProviderDto;
  category: ResourceCategory;
  name: string;
  description: string;
  endpoint: Url;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "UNAVAILABLE";
  prices: ResourcePriceDto[];
  inputSchema: Record<string, unknown>;
  outputContentTypes: string[];
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type CreateResourceListingRequest = {
  category: ResourceCategory;
  name: string;
  description: string;
  endpoint: Url;
  prices: Array<{ assetId: Id; atomicAmount: AtomicAmount }>;
  inputSchema: Record<string, unknown>;
};
```

## 9. API endpoint inventory

### Session and organization

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/session` | Current user, memberships, active organization |
| POST | `/api/v1/organizations` | Create first organization |
| GET | `/api/v1/organization` | Active organization detail |
| PATCH | `/api/v1/organization` | Update organization |
| POST | `/api/v1/organization/kill-switch` | Enable/disable global payment kill switch |
| POST | `/api/v1/auth/wallet/challenges` | Create nonce-bound wallet proof challenge |
| POST | `/api/v1/auth/wallet/verify` | Verify/login/link wallet identity |

### Agents and credentials

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/agents` | Cursor-paginated agent list |
| POST | `/api/v1/agents` | Create/provision agent |
| GET | `/api/v1/agents/:agentId` | Agent detail |
| PATCH | `/api/v1/agents/:agentId` | Edit agent metadata |
| POST | `/api/v1/agents/:agentId/status` | Activate/pause/archive |
| POST | `/api/v1/agents/:agentId/balances/refresh` | Request balance refresh |
| POST | `/api/v1/agents/:agentId/delegations` | Register bounded external signing delegation |
| DELETE | `/api/v1/agents/:agentId/delegations/:delegationId` | Revoke delegation |
| GET | `/api/v1/agents/:agentId/credentials` | List credentials |
| POST | `/api/v1/agents/:agentId/credentials` | Create secret-once credential |
| DELETE | `/api/v1/agents/:agentId/credentials/:credentialId` | Revoke credential |

### Policies

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/agents/:agentId/policies/current` | Active/draft policy |
| PUT | `/api/v1/agents/:agentId/policies/draft` | Create/update draft |
| POST | `/api/v1/agents/:agentId/policies/preview` | Evaluate sample facts |
| POST | `/api/v1/agents/:agentId/policies/publish` | Publish immutable version |

### Payments, approvals, transactions

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/agents/:agentId/paid-requests` | Agent initiates paid resource request |
| GET | `/api/v1/payment-intents/:intentId` | Poll intent/outcome |
| POST | `/api/v1/payment-intents/:intentId/cancel` | Cancel only before signing |
| GET | `/api/v1/approvals` | Approval queue |
| GET | `/api/v1/approvals/:approvalId` | Approval detail |
| POST | `/api/v1/approvals/:approvalId/decision` | Approve/reject |
| GET | `/api/v1/transactions` | Filtered transaction list |
| GET | `/api/v1/transactions/:transactionId` | Transaction detail/timeline |
| POST | `/api/v1/transactions/:transactionId/reconcile` | Authorized/manual reconciliation trigger |

### Reporting and audit

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/overview` | Dashboard aggregate read model |
| GET | `/api/v1/audit-events` | Cursor-paginated audit log |
| GET | `/api/v1/assets` | Supported verified assets |
| GET | `/api/v1/health` | Process liveness |
| GET | `/api/v1/ready` | Dependency readiness, protected details |

### Resource providers

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/resources` | Browse market-data/file/inference/research catalog |
| GET | `/api/v1/resources/:resourceId` | Resource detail and price options |
| POST | `/api/v1/providers` | Create provider profile [Production self-service] |
| POST | `/api/v1/providers/:providerId/wallet-proof` | Verify settlement account |
| GET | `/api/v1/providers/:providerId/resources` | List provider resources |
| POST | `/api/v1/providers/:providerId/resources` | Register resource |
| PATCH | `/api/v1/providers/:providerId/resources/:resourceId` | Version/pause listing |

### Agent-framework packages

| Surface | Contract |
|---|---|
| REST | `/api/v1` OpenAPI source of truth |
| TypeScript SDK | `AgentPayClient`, typed request/outcome/status helpers |
| `SKILL.md` | Safe autonomous-payment operating procedure |
| MCP | `list_resources`, `get_agent_budget`, `request_paid_resource`, `get_payment_status` |
| LangChain | Structured tools wrapping the TypeScript SDK |

## 10. Agent-facing response behavior

The paid-request endpoint is designed for deterministic agent handling:

- `200`: free resource or settled paid resource returned.
- `202`: approval or settlement is pending; response contains intent ID and polling guidance.
- `400`: invalid request/challenge.
- `401/403`: invalid credential/scope or denied authorization.
- `409`: idempotency conflict or unsafe duplicate/unknown submission.
- `422`: valid request but unsupported network/asset/payment option.
- `429`: rate-limited with retry guidance.
- `502/503/504`: external resource/facilitator dependency failure, with `retryable` only when safe.

The agent must never be instructed to retry a `SUBMISSION_UNKNOWN` payment by creating a new idempotency key. It polls the existing intent until reconciliation resolves it.

## 11. x402 wire boundary

Upstream x402 DTOs are versioned external contracts and are not redefined as stable AgentPay public DTOs. The adapter stores/uses:

- `PaymentRequired` from `PAYMENT-REQUIRED`.
- Selected `PaymentRequirements`.
- `PaymentPayload` in `PAYMENT-SIGNATURE`.
- Settlement response in `PAYMENT-RESPONSE`.

At ingress, the adapter validates the pinned protocol version and maps the selected requirement to `PaymentQuoteDto`. At egress, signed payloads remain internal. Any upstream field change is absorbed by the adapter and compatibility tests.

## 12. Validation rules

- IDs are opaque and schema-validated.
- Names are trimmed and Unicode-normalized; control characters prohibited.
- URLs use HTTPS except explicit localhost development; credentials in URLs prohibited.
- Resource redirects are disabled by default or revalidated on every hop.
- Hosts are lowercase IDNA-normalized without scheme/path/port unless port policy explicitly permits it.
- `AtomicAmount` is positive for payments and bounded by asset/platform hard caps.
- Asset/network pairs must be in the server-side verified registry.
- `validUntil` must be future and within maximum challenge lifetime.
- Client-supplied headers use an allowlist; `Authorization`, hop-by-hop, payment, host, and forwarding headers cannot be arbitrarily injected.
- Request body size and paid response size are bounded.

## 13. Production UI/DTO extensions

Deferred extensions include member/RBAC management, multi-approver policies, notification integrations, webhook delivery logs, merchant management, multiple accounts, mainnet enablement, key rotation, exports, billing, support incidents, and policy simulation over historical data. These additions must extend versioned contracts without weakening MVP invariants.
