import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Braces,
  Check,
  ChevronDown,
  CircleDollarSign,
  Code2,
  CreditCard,
  FileCheck2,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Network,
  PauseCircle,
  ReceiptText,
  ShieldCheck,
  Store,
  SquareTerminal,
  UserCheck,
  WalletCards,
  Workflow,
} from "lucide-react";

export type MarketingPageKey =
  | "home"
  | "product"
  | "agent-payments"
  | "agent-commerce"
  | "controls"
  | "developers"
  | "security"
  | "pricing";

type Feature = {
  title: string;
  copy: string;
  icon: typeof ShieldCheck;
};

type DetailPage = {
  eyebrow: string;
  title: string;
  intro: string;
  primaryCta: string;
  primaryHref: Route;
  secondaryCta: string;
  secondaryHref: Route;
  proof: string[];
  sectionEyebrow: string;
  sectionTitle: string;
  sectionIntro: string;
  features: Feature[];
  steps: Array<{ number: string; title: string; copy: string }>;
  closingTitle: string;
  closingCopy: string;
};

const productItems: Array<{ href: Route; label: string; copy: string }> = [
  { href: "/product", label: "Product overview", copy: "One control plane for agent spending." },
  { href: "/agent-payments", label: "Agent payments", copy: "Policy-controlled x402 payment flows." },
  { href: "/controls", label: "Controls & approvals", copy: "Budgets, limits, approvals and kill switches." },
  { href: "/agent-commerce", label: "Agent commerce", copy: "Verified agent-to-agent transactions." },
];

const solutionItems: Array<{ href: Route; label: string; copy: string }> = [
  { href: "/agent-payments", label: "Paid APIs & resources", copy: "Let software purchase what it needs." },
  { href: "/agent-commerce", label: "Agent marketplaces", copy: "Discover, verify and pay other agents." },
  { href: "/controls", label: "Teams & operators", copy: "Delegate spend without giving up control." },
  { href: "/developers", label: "Developer platforms", copy: "Add governed payments to agent workflows." },
];

const detailPages: Record<Exclude<MarketingPageKey, "home" | "pricing">, DetailPage> = {
  product: {
    eyebrow: "Product",
    title: "One place to govern how software spends.",
    intro:
      "AgentPay connects payment execution, policy, approvals, credentials and audit trails so autonomous software can transact without receiving unrestricted financial access.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "Explore controls",
    secondaryHref: "/controls",
    proof: ["Policy-first execution", "Multi-rail settlement", "Human approval paths"],
    sectionEyebrow: "A financial operating layer",
    sectionTitle: "Built around decisions, not just transactions.",
    sectionIntro:
      "Every payment starts with context: which agent is acting, what it wants to buy, which policy applies, which rail can settle it and whether a human needs to approve it.",
    features: [
      { title: "Policy engine", copy: "Set transaction, daily and asset-level rules that are evaluated before funds move.", icon: ShieldCheck },
      { title: "Agent budgets", copy: "Give each agent clear financial boundaries without exposing a general-purpose wallet.", icon: Gauge },
      { title: "Approvals", copy: "Route exceptional spend to an operator while routine activity continues automatically.", icon: UserCheck },
      { title: "Scoped credentials", copy: "Issue credentials for specific agents and actions instead of sharing operator secrets.", icon: KeyRound },
      { title: "Payment rails", copy: "Coordinate configured Cardano and x402 flows behind one operating model.", icon: Network },
      { title: "Audit & reconciliation", copy: "Keep the policy decision, payment state and settlement evidence connected.", icon: FileCheck2 },
    ],
    steps: [
      { number: "01", title: "The agent requests a purchase", copy: "AgentPay receives the intended resource, amount, asset and payee." },
      { number: "02", title: "Policy decides the path", copy: "The request is allowed, blocked or held for human approval." },
      { number: "03", title: "Settlement is verified", copy: "Approved payments are executed and attached to an auditable record." },
    ],
    closingTitle: "Autonomy works better with boundaries.",
    closingCopy: "Give software room to operate while keeping money inside explicit, reviewable rules.",
  },
  "agent-payments": {
    eyebrow: "Agent payments",
    title: "Payments that software can complete on its own.",
    intro:
      "Let an agent encounter a paid resource, request payment, pass policy checks, settle and continue its task without stopping for a card number or unrestricted wallet key.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "Developer integration",
    secondaryHref: "/developers",
    proof: ["x402-aware flows", "USDCx-ready policy controls", "Cardano settlement"],
    sectionEyebrow: "From paywall to result",
    sectionTitle: "Turn payment requirements into a normal part of execution.",
    sectionIntro:
      "AgentPay sits between the agent and the payment rail. The agent asks for an outcome; AgentPay handles whether and how the money is allowed to move.",
    features: [
      { title: "x402 purchase flow", copy: "Interpret payment-required responses and continue after approved settlement.", icon: ReceiptText },
      { title: "Stable-value policies", copy: "Express limits in understandable monetary terms while the payment rail uses supported assets.", icon: CircleDollarSign },
      { title: "Payee controls", copy: "Restrict which providers, addresses or resources an agent is permitted to purchase.", icon: Fingerprint },
      { title: "Confirmation tracking", copy: "Keep the agent informed about pending, confirmed and failed payment states.", icon: Check },
      { title: "Resource continuity", copy: "Return the paid resource to the workflow once settlement requirements are met.", icon: Workflow },
      { title: "Operator visibility", copy: "See what was purchased, by whom, for how much and under which policy.", icon: BarChart3 },
    ],
    steps: [
      { number: "01", title: "A resource asks for payment", copy: "The agent receives a payment requirement instead of a dead end." },
      { number: "02", title: "AgentPay evaluates it", copy: "Budget, asset, payee and approval policies are checked." },
      { number: "03", title: "The task continues", copy: "After verified settlement, the resource is returned to the agent." },
    ],
    closingTitle: "Make paid resources usable by software.",
    closingCopy: "Move from manual checkout interruptions to governed, machine-completable payments.",
  },
  "agent-commerce": {
    eyebrow: "Agent commerce",
    title: "Let software hire software—with verification in the middle.",
    intro:
      "AgentPay supports an agent-to-agent commerce model where identity, job terms, payment policy and settlement are checked before one agent pays another for work.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "See payment controls",
    secondaryHref: "/controls",
    proof: ["Masumi workflows", "Seller verification", "Policy-gated jobs"],
    sectionEyebrow: "A governed agent economy",
    sectionTitle: "Commerce needs more than a wallet.",
    sectionIntro:
      "Discovery and payment are only useful when the buyer can verify who it is paying, what was requested and whether the transaction is allowed.",
    features: [
      { title: "Agent discovery", copy: "Connect buyer workflows to compatible agent services and marketplace resources.", icon: Store },
      { title: "Identity checks", copy: "Verify participating agent identities before a policy allows payment.", icon: Fingerprint },
      { title: "Job lifecycle", copy: "Track the relationship between job creation, payment state and returned work.", icon: Workflow },
      { title: "Seller restrictions", copy: "Allow commerce only with approved or verified counterparties.", icon: ShieldCheck },
      { title: "Budget ownership", copy: "Keep the buyer agent inside the budget assigned by its human operator.", icon: Gauge },
      { title: "Commerce receipts", copy: "Retain transaction and job evidence for later review and reconciliation.", icon: ReceiptText },
    ],
    steps: [
      { number: "01", title: "Find the right service", copy: "A buyer agent selects another agent or paid capability." },
      { number: "02", title: "Verify and authorize", copy: "Identity, price, seller and budget policies are checked." },
      { number: "03", title: "Pay against the job", copy: "Settlement and result state remain linked throughout the workflow." },
    ],
    closingTitle: "Agent-to-agent commerce, with an operator still in charge.",
    closingCopy: "Enable software to buy specialist work without turning every agent into an unrestricted treasury account.",
  },
  controls: {
    eyebrow: "Controls & approvals",
    title: "Set the rules once. Enforce them on every payment.",
    intro:
      "AgentPay gives operators a readable control layer for budgets, transaction limits, approved counterparties, assets, human approvals and emergency stops.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "See the full product",
    secondaryHref: "/product",
    proof: ["Per-agent budgets", "Approval thresholds", "Emergency stop"],
    sectionEyebrow: "Policy before payment",
    sectionTitle: "Financial boundaries that match how teams actually delegate.",
    sectionIntro:
      "Routine low-risk transactions can move automatically. Larger or unusual requests can pause for review. Disallowed activity is blocked before settlement.",
    features: [
      { title: "Per-transaction limits", copy: "Cap the maximum amount an individual agent can spend in one request.", icon: CircleDollarSign },
      { title: "Daily budgets", copy: "Control aggregate spend over time instead of evaluating each payment in isolation.", icon: Gauge },
      { title: "Human approvals", copy: "Require an operator decision when a payment crosses the threshold you define.", icon: UserCheck },
      { title: "Asset restrictions", copy: "Define which configured settlement assets an agent is allowed to use.", icon: WalletCards },
      { title: "Counterparty rules", copy: "Limit spend to trusted resources, providers or verified agent identities.", icon: Fingerprint },
      { title: "Emergency stop", copy: "Disable risky financial side effects while retaining defensive and reconciliation access.", icon: PauseCircle },
    ],
    steps: [
      { number: "01", title: "Define the boundary", copy: "Create the budget, payee, asset and approval rules for an agent." },
      { number: "02", title: "Let routine work flow", copy: "Requests inside policy can proceed without manual intervention." },
      { number: "03", title: "Escalate exceptions", copy: "Riskier requests are blocked or queued for an operator decision." },
    ],
    closingTitle: "Delegate execution—not unlimited authority.",
    closingCopy: "Keep autonomy useful by making the financial limits explicit before the agent starts spending.",
  },
  developers: {
    eyebrow: "Developers",
    title: "Give your agent a payment capability, not your wallet.",
    intro:
      "Connect AgentPay through hosted MCP and application interfaces so agents can discover resources, request governed purchases and read payment state from the tools they already use.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "View security",
    secondaryHref: "/security",
    proof: ["Hosted MCP", "Scoped agent credentials", "REST-style interfaces"],
    sectionEyebrow: "Built to connect",
    sectionTitle: "A small integration surface for a complicated financial job.",
    sectionIntro:
      "Your application focuses on what the agent is trying to accomplish. AgentPay centralizes financial policy, payment execution and audit context.",
    features: [
      { title: "Hosted MCP", copy: "Expose AgentPay capabilities to compatible coding and agent environments through MCP.", icon: SquareTerminal },
      { title: "Resource discovery", copy: "Let agents understand what purchasable resources are available before they spend.", icon: Store },
      { title: "Purchase tools", copy: "Request a policy-controlled purchase through a structured application interface.", icon: Braces },
      { title: "Status tools", copy: "Read payment and settlement state without scraping a human dashboard.", icon: ReceiptText },
      { title: "Scoped credentials", copy: "Use agent-specific credentials designed around least-privilege access.", icon: KeyRound },
      { title: "Framework friendly", copy: "Fit AgentPay into coding agents, orchestration frameworks and custom clients.", icon: Code2 },
    ],
    steps: [
      { number: "01", title: "Register the agent", copy: "Create the agent identity and assign the policy it will operate under." },
      { number: "02", title: "Connect its tools", copy: "Use MCP or application interfaces to expose purchasing capabilities." },
      { number: "03", title: "Build against outcomes", copy: "Your agent requests purchases while AgentPay handles the financial guardrails." },
    ],
    closingTitle: "Keep financial logic out of every agent prompt.",
    closingCopy: "Put payment rules in infrastructure where they can be reviewed, tested and enforced consistently.",
  },
  security: {
    eyebrow: "Security",
    title: "Financial autonomy designed to fail closed.",
    intro:
      "AgentPay treats payment authorization as a security boundary. Risky operations depend on verified operator state, explicit policies, scoped credentials and verifiable settlement evidence.",
    primaryCta: "Open AgentPay",
    primaryHref: "/sign-in",
    secondaryCta: "Explore controls",
    secondaryHref: "/controls",
    proof: ["Least-privilege credentials", "Fail-closed policy paths", "Auditable decisions"],
    sectionEyebrow: "Defense in depth",
    sectionTitle: "A payment system should assume software can make mistakes.",
    sectionIntro:
      "Controls are designed so a malformed request, stale dependency or unavailable verification path does not silently become permission to spend.",
    features: [
      { title: "Scoped access", copy: "Separate operator authority from the narrower capabilities issued to individual agents.", icon: KeyRound },
      { title: "Fail-closed checks", copy: "Keep signing disabled when required operator or policy state cannot be verified.", icon: LockKeyhole },
      { title: "Policy enforcement", copy: "Evaluate spend constraints before invoking the configured settlement path.", icon: ShieldCheck },
      { title: "Counterparty verification", copy: "Use identity and seller checks where agent-commerce policy requires them.", icon: Fingerprint },
      { title: "Settlement evidence", copy: "Attach confirmation and reconciliation data to payment records for review.", icon: FileCheck2 },
      { title: "Emergency controls", copy: "Stop risky side effects without losing visibility into existing financial state.", icon: PauseCircle },
    ],
    steps: [
      { number: "01", title: "Authenticate the actor", copy: "Establish which operator or agent is making the request." },
      { number: "02", title: "Evaluate the decision", copy: "Apply organization, agent, payee, asset and budget constraints." },
      { number: "03", title: "Prove the outcome", copy: "Record the resulting decision and settlement evidence for later audit." },
    ],
    closingTitle: "Security is part of the payment path.",
    closingCopy: "AgentPay puts financial controls between autonomous software and irreversible settlement actions.",
  },
};

function MarketingHeader() {
  return (
    <header className="m-header">
      <div className="m-container m-nav">
        <Link className="m-brand" href="/" aria-label="AgentPay home">
          <Image src="/brand/agentpay-lockup.png" alt="AgentPay" width={166} height={34} priority />
        </Link>

        <nav className="m-desktop-nav" aria-label="Marketing navigation">
          <details className="m-nav-menu">
            <summary>Product <ChevronDown size={13} aria-hidden="true" /></summary>
            <div className="m-nav-popover">
              {productItems.map((item) => (
                <Link href={item.href} key={item.href}>
                  <strong>{item.label}</strong>
                  <span>{item.copy}</span>
                </Link>
              ))}
            </div>
          </details>
          <details className="m-nav-menu">
            <summary>Solutions <ChevronDown size={13} aria-hidden="true" /></summary>
            <div className="m-nav-popover">
              {solutionItems.map((item) => (
                <Link href={item.href} key={`${item.href}-${item.label}`}>
                  <strong>{item.label}</strong>
                  <span>{item.copy}</span>
                </Link>
              ))}
            </div>
          </details>
          <Link href="/developers">Developers</Link>
          <Link href="/security">Security</Link>
          <Link href="/pricing">Pricing</Link>
        </nav>

        <div className="m-nav-actions">
          <Link className="m-login" href="/sign-in">Log in</Link>
          <Link className="m-button m-button-small" href="/sign-in">Open AgentPay</Link>
        </div>

        <details className="m-mobile-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            {productItems.map((item) => (
              <Link href={item.href} key={`mobile-${item.href}-${item.label}`}>{item.label}</Link>
            ))}
            <Link href="/developers">Developers</Link>
            <Link href="/security">Security</Link>
            <Link href="/pricing">Pricing</Link>
            <Link className="m-button" href="/sign-in">Open AgentPay</Link>
          </div>
        </details>
      </div>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="m-footer">
      <div className="m-container">
        <div className="m-footer-top">
          <div>
            <Image src="/brand/agentpay-lockup.png" alt="AgentPay" width={160} height={33} />
            <p>Financial controls and payment infrastructure for autonomous software.</p>
          </div>
          <div className="m-footer-links">
            <div>
              <span>Product</span>
              <Link href="/product">Overview</Link>
              <Link href="/agent-payments">Agent payments</Link>
              <Link href="/agent-commerce">Agent commerce</Link>
              <Link href="/controls">Controls & approvals</Link>
            </div>
            <div>
              <span>Build</span>
              <Link href="/developers">Developers</Link>
              <Link href="/security">Security</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/sign-in">Dashboard</Link>
            </div>
          </div>
        </div>
        <div className="m-footer-bottom">
          <span>AgentPay</span>
          <span>Built for governed software spending.</span>
        </div>
      </div>
    </footer>
  );
}

function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site">
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

function ArrowLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link className="m-arrow-link" href={href}>
      {children} <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

function HeroControlPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`m-hero-product${compact ? " compact" : ""}`} aria-label="AgentPay product preview">
      <div className="m-floating-card m-floating-budget">
        <span>Research agent</span>
        <strong>$31.40 <small>/ $100 daily</small></strong>
        <div className="m-progress"><i /></div>
      </div>
      <div className="m-product-window">
        <div className="m-product-chrome">
          <div><span /><span /><span /></div>
          <small>agentpay / payment control</small>
        </div>
        <div className="m-product-body">
          <div className="m-product-side">
            <div className="m-mini-brand"><Image src="/brand/agentpay-mark.png" alt="" width={24} height={24} /></div>
            <i className="active" /><i /><i /><i /><i />
          </div>
          <div className="m-product-main">
            <div className="m-product-heading">
              <div>
                <span>Payment request</span>
                <strong>Premium market dataset</strong>
              </div>
              <em>Policy check</em>
            </div>
            <div className="m-policy-row">
              <span className="m-policy-icon"><ShieldCheck size={17} /></span>
              <div><small>Agent policy</small><strong>Research / standard</strong></div>
              <b>Allowed</b>
            </div>
            <div className="m-policy-grid">
              <div><small>Amount</small><strong>4.20 USDCx</strong></div>
              <div><small>Provider</small><strong>Verified</strong></div>
              <div><small>Budget after</small><strong>$64.40</strong></div>
              <div><small>Approval</small><strong>Not required</strong></div>
            </div>
            <div className="m-confirm-row">
              <div><Check size={16} /><span>Ready to settle on Cardano</span></div>
              <button type="button" tabIndex={-1}>Approve payment</button>
            </div>
          </div>
        </div>
      </div>
      <div className="m-floating-card m-floating-receipt">
        <span>Latest settlement</span>
        <div><Check size={15} /><strong>Confirmed</strong></div>
        <small>4.20 USDCx · dataset API</small>
      </div>
    </div>
  );
}

function HomePage() {
  const pillars: Feature[] = [
    { title: "Agent payments", copy: "Let software pay for APIs, data and services without handing it unrestricted wallet access.", icon: WalletCards },
    { title: "Controls & approvals", copy: "Set budgets, payee rules and approval thresholds before autonomous work begins.", icon: ShieldCheck },
    { title: "Agent commerce", copy: "Verify and govern payments when one agent hires or purchases from another.", icon: Store },
  ];

  return (
    <MarketingLayout>
      <section className="m-home-hero">
        <div className="m-container m-home-hero-grid">
          <div className="m-home-copy">
            <span className="m-kicker">Financial infrastructure for autonomous software</span>
            <h1>Let software spend.<br />Keep the rules human.</h1>
            <p>
              AgentPay gives autonomous agents a governed way to pay for resources, services and other agents—inside budgets, policies and approval rules you control.
            </p>
            <div className="m-hero-actions">
              <Link className="m-button" href="/sign-in">Open AgentPay</Link>
              <ArrowLink href="/product">Explore the product</ArrowLink>
            </div>
            <small className="m-hero-note">No unrestricted wallet access. No approval fatigue for routine spend.</small>
          </div>
          <HeroControlPanel />
        </div>
        <div className="m-container m-trust-strip">
          <span>Built across modern agent-payment infrastructure</span>
          <div>
            <strong>Cardano</strong>
            <strong>USDCx</strong>
            <strong>x402</strong>
            <strong>Masumi</strong>
            <strong>Pyth</strong>
            <strong>MCP</strong>
          </div>
        </div>
      </section>

      <section className="m-section m-white">
        <div className="m-container">
          <div className="m-section-heading m-wide-heading">
            <div>
              <span className="m-kicker">The control layer</span>
              <h2>Autonomy should not mean unlimited authority.</h2>
            </div>
            <p>
              Agents can make thousands of small decisions. Financial decisions need a durable set of boundaries that does not live only inside a prompt.
            </p>
          </div>
          <div className="m-pillar-grid">
            {pillars.map((item) => (
              <Link className="m-pillar-card" href={item.title === "Agent payments" ? "/agent-payments" : item.title === "Agent commerce" ? "/agent-commerce" : "/controls"} key={item.title}>
                <div className="m-pillar-icon"><item.icon size={24} /></div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
                <span>Learn more <ArrowRight size={14} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="m-section m-soft-section">
        <div className="m-container m-split">
          <div className="m-split-copy">
            <span className="m-kicker">A payment path with context</span>
            <h2>From request to settlement, every step stays connected.</h2>
            <p>
              AgentPay evaluates who is spending, what they are buying, how much it costs and whether the request fits the active policy before it reaches a settlement rail.
            </p>
            <div className="m-check-list">
              <span><Check size={15} /> Budget and transaction limits</span>
              <span><Check size={15} /> Approved assets and counterparties</span>
              <span><Check size={15} /> Human approval when policy requires it</span>
              <span><Check size={15} /> Settlement and audit evidence</span>
            </div>
            <ArrowLink href="/controls">See controls & approvals</ArrowLink>
          </div>
          <div className="m-flow-board">
            {[
              ["01", "Agent requests", "Dataset · 4.20 USDCx"],
              ["02", "Policy evaluates", "Budget ✓  Payee ✓  Asset ✓"],
              ["03", "Payment settles", "Cardano · confirmed"],
              ["04", "Resource returns", "Workflow continues"],
            ].map(([number, title, copy]) => (
              <div className="m-flow-row" key={number}>
                <b>{number}</b>
                <div><strong>{title}</strong><span>{copy}</span></div>
                <Check size={16} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="m-section m-white">
        <div className="m-container">
          <div className="m-section-heading">
            <span className="m-kicker">Software-to-software commerce</span>
            <h2>Give agents a way to buy what their work actually needs.</h2>
            <p>
              Paid APIs, premium data and specialist agents become reachable without converting each purchase into a manual checkout task.
            </p>
          </div>
          <div className="m-commerce-showcase">
            <div className="m-commerce-copy-card">
              <span className="m-label">Buyer agent</span>
              <h3>Research Europe&apos;s battery supply chain</h3>
              <p>Budget: $100 · Approved providers only</p>
              <div className="m-commerce-line"><span>Premium trade dataset</span><strong>$4.20</strong></div>
              <div className="m-commerce-line"><span>Masumi research service</span><strong>$15.00</strong></div>
              <div className="m-commerce-line muted"><span>Cloud upgrade</span><strong>Blocked</strong></div>
            </div>
            <div className="m-commerce-connector">
              <span>AgentPay</span><i /><b>policy + payment</b><i />
            </div>
            <div className="m-commerce-copy-card">
              <span className="m-label">Result</span>
              <h3>Work continues after verified payment.</h3>
              <p>The buying workflow receives the paid resource or completed service without exposing an operator wallet.</p>
              <ArrowLink href="/agent-commerce">Explore agent commerce</ArrowLink>
            </div>
          </div>
        </div>
      </section>

      <section className="m-section m-dark-section">
        <div className="m-container m-developer-split">
          <div>
            <span className="m-kicker light">For developers</span>
            <h2>Connect financial capabilities without rebuilding financial controls.</h2>
            <p>Use AgentPay from compatible agent environments and custom applications through a small set of payment-oriented tools.</p>
            <ArrowLink href="/developers">Developer overview</ArrowLink>
          </div>
          <div className="m-code-card">
            <div className="m-code-top"><span>purchase-resource.ts</span><small>MCP / application flow</small></div>
            <pre><code>{`const result = await agentpay.purchase({
  resource: "premium-market-data",
  budget: "research-agent",
  maxAmount: "5.00 USD"
});

// policy: allowed
// settlement: confirmed
// resource: returned`}</code></pre>
          </div>
        </div>
      </section>

      <section className="m-section m-white">
        <div className="m-container m-security-band">
          <div>
            <span className="m-kicker">Security by architecture</span>
            <h2>Give each agent less authority than the operator behind it.</h2>
          </div>
          <div className="m-security-points">
            <span><LockKeyhole size={19} /><b>Scoped credentials</b><small>Separate agent access from operator authority.</small></span>
            <span><PauseCircle size={19} /><b>Emergency stop</b><small>Disable risky side effects when needed.</small></span>
            <span><FileCheck2 size={19} /><b>Audit trail</b><small>Keep decisions and settlement evidence connected.</small></span>
          </div>
          <ArrowLink href="/security">Read about security</ArrowLink>
        </div>
      </section>

      <ClosingBand />
    </MarketingLayout>
  );
}

function DetailVisual({ page }: { page: Exclude<MarketingPageKey, "home" | "pricing"> }) {
  if (page === "developers") {
    return (
      <div className="m-detail-code">
        <div className="m-code-top"><span>AgentPay tools</span><small>connected</small></div>
        <div className="m-tool-row"><SquareTerminal size={18} /><div><strong>discover_resources</strong><span>Find purchasable capabilities</span></div><Check size={15} /></div>
        <div className="m-tool-row"><CreditCard size={18} /><div><strong>purchase_resource</strong><span>Request policy-controlled payment</span></div><Check size={15} /></div>
        <div className="m-tool-row"><ReceiptText size={18} /><div><strong>payment_status</strong><span>Read settlement state</span></div><Check size={15} /></div>
        <div className="m-detail-code-footer"><KeyRound size={15} /> Scoped credential · research-agent</div>
      </div>
    );
  }

  if (page === "security") {
    return (
      <div className="m-security-visual">
        <div className="m-security-ring"><ShieldCheck size={34} /><strong>Policy boundary</strong></div>
        <div className="m-security-rule"><span>Identity verified</span><Check size={16} /></div>
        <div className="m-security-rule"><span>Budget within limit</span><Check size={16} /></div>
        <div className="m-security-rule"><span>Payee approved</span><Check size={16} /></div>
        <div className="m-security-rule"><span>Settlement evidence</span><Check size={16} /></div>
      </div>
    );
  }

  if (page === "controls") {
    return (
      <div className="m-controls-visual">
        <div className="m-control-header"><span>Research agent</span><b>Active</b></div>
        <div className="m-control-budget"><small>Daily budget</small><strong>$31.40 / $100</strong><div className="m-progress"><i /></div></div>
        <div className="m-control-rule"><span>Transaction limit</span><strong>$20.00</strong></div>
        <div className="m-control-rule"><span>Approval above</span><strong>$50.00</strong></div>
        <div className="m-control-rule"><span>Allowed asset</span><strong>USDCx</strong></div>
        <div className="m-control-rule"><span>Verified providers</span><strong>Required</strong></div>
      </div>
    );
  }

  if (page === "agent-commerce") {
    return (
      <div className="m-agent-commerce-visual">
        <div className="m-agent-node"><Bot size={20} /><span>Buyer agent</span><small>$100 budget</small></div>
        <div className="m-commerce-path"><span>verify</span><i /><b>AgentPay</b><i /><span>pay</span></div>
        <div className="m-agent-node"><Store size={20} /><span>Research service</span><small>Masumi verified</small></div>
        <div className="m-job-status"><Check size={15} /><span>Job + payment linked</span></div>
      </div>
    );
  }

  return <HeroControlPanel compact />;
}

function DetailPageView({ page }: { page: Exclude<MarketingPageKey, "home" | "pricing"> }) {
  const content = detailPages[page];

  return (
    <MarketingLayout>
      <section className="m-detail-hero">
        <div className="m-container m-detail-hero-grid">
          <div>
            <span className="m-kicker">{content.eyebrow}</span>
            <h1>{content.title}</h1>
            <p>{content.intro}</p>
            <div className="m-hero-actions">
              <Link className="m-button" href={content.primaryHref}>{content.primaryCta}</Link>
              <ArrowLink href={content.secondaryHref}>{content.secondaryCta}</ArrowLink>
            </div>
            <div className="m-detail-proof">
              {content.proof.map((item) => <span key={item}><Check size={13} />{item}</span>)}
            </div>
          </div>
          <DetailVisual page={page} />
        </div>
      </section>

      <section className="m-section m-white">
        <div className="m-container">
          <div className="m-section-heading m-wide-heading">
            <div>
              <span className="m-kicker">{content.sectionEyebrow}</span>
              <h2>{content.sectionTitle}</h2>
            </div>
            <p>{content.sectionIntro}</p>
          </div>
          <div className="m-feature-grid">
            {content.features.map((feature) => (
              <div className="m-feature-card" key={feature.title}>
                <span><feature.icon size={21} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="m-section m-soft-section">
        <div className="m-container">
          <div className="m-section-heading">
            <span className="m-kicker">How it works</span>
            <h2>Three steps from intent to controlled execution.</h2>
          </div>
          <div className="m-step-grid">
            {content.steps.map((step) => (
              <div className="m-step-card" key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="m-section m-white">
        <div className="m-container m-detail-closing">
          <span className="m-kicker">AgentPay</span>
          <h2>{content.closingTitle}</h2>
          <p>{content.closingCopy}</p>
          <div className="m-hero-actions centered">
            <Link className="m-button" href="/sign-in">Open AgentPay</Link>
            <ArrowLink href="/developers">Developer overview</ArrowLink>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

function PricingPage() {
  const tiers = [
    {
      name: "Developer",
      meta: "For prototypes and individual builders",
      price: "Usage-based",
      copy: "Start with the core payment and policy workflow while you build your integration.",
      features: ["Agent policies", "Payment activity", "Developer interfaces", "Test environments"],
      cta: "Open AgentPay",
    },
    {
      name: "Team",
      meta: "For production agent operations",
      price: "Team plan",
      copy: "Operate multiple agents with approvals, shared controls and stronger organizational workflows.",
      features: ["Everything in Developer", "Human approvals", "Team roles", "Audit & reconciliation"],
      cta: "Open AgentPay",
      featured: true,
    },
    {
      name: "Enterprise",
      meta: "For platforms and larger organizations",
      price: "Custom",
      copy: "Plan higher-volume, governance-heavy deployments around your operating and security requirements.",
      features: ["Everything in Team", "Custom policy design", "Deployment support", "Enterprise controls"],
      cta: "Explore product",
    },
  ];

  return (
    <MarketingLayout>
      <section className="m-pricing-hero">
        <div className="m-container">
          <span className="m-kicker">Pricing</span>
          <h1>Start small. Add control as agent spending grows.</h1>
          <p>AgentPay pricing is structured around the level of operational control and support your agent workflows need.</p>
        </div>
      </section>
      <section className="m-pricing-section">
        <div className="m-container m-pricing-grid">
          {tiers.map((tier) => (
            <div className={`m-price-card${tier.featured ? " featured" : ""}`} key={tier.name}>
              <span className="m-label">{tier.meta}</span>
              <h2>{tier.name}</h2>
              <strong className="m-price">{tier.price}</strong>
              <p>{tier.copy}</p>
              <div className="m-price-features">
                {tier.features.map((feature) => <span key={feature}><Check size={14} />{feature}</span>)}
              </div>
              <Link className={tier.featured ? "m-button" : "m-button m-button-quiet"} href={tier.name === "Enterprise" ? "/product" : "/sign-in"}>{tier.cta}</Link>
            </div>
          ))}
        </div>
        <div className="m-container m-pricing-note">
          <strong>Pricing note</strong>
          <p>Commercial terms and production usage pricing are still being finalized. The plan structure above describes the intended product packaging rather than a binding offer.</p>
        </div>
      </section>
      <ClosingBand />
    </MarketingLayout>
  );
}

function ClosingBand() {
  return (
    <section className="m-closing-band">
      <div className="m-container">
        <div>
          <span className="m-kicker light">Ready when your agents are</span>
          <h2>Give autonomous software a financial boundary it can work inside.</h2>
        </div>
        <div className="m-closing-actions">
          <Link className="m-button m-button-light" href="/sign-in">Open AgentPay</Link>
          <Link href="/developers">Build with AgentPay <ArrowRight size={15} /></Link>
        </div>
      </div>
    </section>
  );
}

export function MarketingSite({ page }: { page: MarketingPageKey }) {
  if (page === "home") return <HomePage />;
  if (page === "pricing") return <PricingPage />;
  return <DetailPageView page={page} />;
}
