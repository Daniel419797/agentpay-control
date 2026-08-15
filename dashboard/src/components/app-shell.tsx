"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Bot, Boxes, BrainCircuit, CircleDollarSign, ClipboardCheck, CreditCard,
  FileClock, FileText, GitBranch, LayoutDashboard, LogOut, Menu, Plus, ReceiptText, Repeat2,
  Settings, ShieldCheck, Store
} from "lucide-react";
import { HederaWalletConnect } from "@/components/hedera-wallet-connect";
import { ArcWalletConnect } from "@/components/arc-wallet-connect";
import { CardanoWalletConnect } from "@/components/cardano-wallet-connect";
import { NetworkProvider, useNetwork } from "@/domain/network-context";
import { NetworkSwitcher } from "@/components/network-switcher";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

const navigation: Array<{ label: string; href: Route; icon: typeof LayoutDashboard; group?: string }> = [
  { label: "Overview", href: "/app/overview", icon: LayoutDashboard, group: "Operate" },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Approvals", href: "/app/approvals", icon: ClipboardCheck },
  { label: "Transactions", href: "/app/transactions", icon: ReceiptText },
  { label: "Agent commerce", href: "/app/agent-commerce", icon: CircleDollarSign },
  { label: "Cards & fiat", href: "/app/cards", icon: CreditCard, group: "Money" },
  { label: "Invoices", href: "/app/invoices", icon: FileText },
  { label: "Cross-chain", href: "/app/cross-chain", icon: Repeat2 },
  { label: "Marketplace", href: "/app/marketplace", icon: Store, group: "Build" },
  { label: "Resources", href: "/app/resources", icon: Boxes },
  { label: "Automations", href: "/app/automations", icon: GitBranch },
  { label: "Intelligence", href: "/app/intelligence", icon: BrainCircuit, group: "Review" },
  { label: "Cardano analytics", href: "/app/analytics/cardano", icon: Activity },
  { label: "Audit", href: "/app/audit", icon: FileClock },
  { label: "Settings", href: "/app/settings", icon: Settings }
];

type OperatingState = "LOADING" | "OPEN" | "STOPPED" | "ERROR";

function SignerControl({ operatingState }: { operatingState: OperatingState }) {
  const { network } = useNetwork();
  if (operatingState !== "OPEN") {
    const title = operatingState === "STOPPED"
      ? "New payment signing is disabled while the emergency stop is active"
      : operatingState === "ERROR"
        ? "Signing is disabled because operator state could not be verified"
        : "Signing is disabled until operator state is verified";
    return <span className="account-chip" title={title}>Signing disabled</span>;
  }
  if (network === "eip155:5042002") return <ArcWalletConnect />;
  if (network === "cardano:preprod" || network === "cardano:mainnet") return <CardanoWalletConnect />;
  return <HederaWalletConnect />;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [operatorEmail, setOperatorEmail] = useState("Loading operator…");
  const [roles, setRoles] = useState<string[]>([]);
  const [operatingState, setOperatingState] = useState<OperatingState>("LOADING");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
        return response.json();
      })
      .then((body: { data?: { user?: { email?: string }; roles?: string[]; activeOrganization?: { status?: string; killSwitchEnabled?: boolean } } }) => {
        const organization = body.data?.activeOrganization;
        if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
        setOperatorEmail(body.data?.user?.email ?? "Signed-in operator");
        setRoles(body.data?.roles ?? []);
        setOperatingState(organization.killSwitchEnabled ? "STOPPED" : "OPEN");
      })
      .catch(() => {
        setOperatorEmail("Operator state unavailable");
        setRoles([]);
        setOperatingState("ERROR");
      });
  }, []);

  const canCreateAgent = operatingState === "OPEN" && (roles.includes("OWNER") || roles.includes("OPERATOR"));

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { await fetch("/api/v1/auth/sign-out", { method: "POST" }); }
    finally { window.location.assign("/sign-in"); }
  }

  return (
    <div className="app-shell">
      {navOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar${navOpen ? " sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-brand"><Image src="/brand/agentpay-lockup-white.png" alt="AgentPay" width={177} height={35} priority /></div>
        <nav className="nav-list">
          {navigation.map((item) => <div className="nav-entry" key={item.href}>{item.group && <span className="nav-group">{item.group}</span>}<Link className={`nav-link${pathname === item.href || (item.href !== "/app/overview" && pathname.startsWith(`${item.href}/`)) ? " active" : ""}`} href={item.href} onClick={() => setNavOpen(false)}><item.icon aria-hidden="true" size={17} />{item.label}</Link></div>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-context"><span className="context-label">Workspace</span><WorkspaceSwitcher compact /></div>
        <div className="sidebar-context"><span className="context-label">Environment</span><NetworkSwitcher compact /></div>
        <div className="sidebar-context"><span className="context-label">Operator</span><span className="context-value">{operatorEmail}</span></div>
        <button className="nav-link" type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out"><LogOut aria-hidden="true" size={17} />{signingOut ? "Signing out…" : "Sign out"}</button>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="mobile-nav-button" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}><Menu size={20} /></button>
            <span className="topbar-title">Payment operations</span>
          </div>
          <div className="topbar-actions">
            <NetworkSwitcher />
            <SignerControl operatingState={operatingState} />
            {canCreateAgent && <Link className="primary-button" href="/app/agents/new" aria-label="Create agent"><Plus size={16} aria-hidden="true" /><span>Create agent</span></Link>}
          </div>
        </header>
        {operatingState === "STOPPED" && <div className="form-error" role="status" style={{ margin: "16px 24px 0" }}><strong>Emergency stop active.</strong> New payment signing, card/fiat provisioning, cross-chain preparation, credentials, and automation side effects are disabled. Reconciliation and defensive actions remain available.</div>}
        {operatingState === "ERROR" && <div className="form-error" role="alert" style={{ margin: "16px 24px 0" }}><strong>Operator state could not be verified.</strong> Payment signing and other risky actions remain disabled until the session and active workspace can be verified.</div>}
        {children}
      </main>
    </div>
  );
}

export function AppShell({
  children,
  mainnetEnabled = true,
  arcEnabled = false,
  cardanoPreprodEnabled = false,
  cardanoMainnetEnabled = false,
}: {
  children: React.ReactNode;
  mainnetEnabled?: boolean;
  arcEnabled?: boolean;
  cardanoPreprodEnabled?: boolean;
  cardanoMainnetEnabled?: boolean;
}) {
  return (
    <NetworkProvider
      mainnetEnabled={mainnetEnabled}
      arcEnabled={arcEnabled}
      cardanoPreprodEnabled={cardanoPreprodEnabled}
      cardanoMainnetEnabled={cardanoMainnetEnabled}
    >
      <ShellContent>{children}</ShellContent>
    </NetworkProvider>
  );
}

export const shellIcons = { Activity, CircleDollarSign, ShieldCheck };
