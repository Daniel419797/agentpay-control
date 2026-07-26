"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Bot, Boxes, BrainCircuit, CircleDollarSign, ClipboardCheck, CreditCard,
  FileClock, FileText, GitBranch, LayoutDashboard, Menu, Plus, ReceiptText, Repeat2,
  Settings, ShieldCheck, Store
} from "lucide-react";
import { HederaWalletConnect } from "@/components/hedera-wallet-connect";

const navigation: Array<{ label: string; href: Route; icon: typeof LayoutDashboard; group?: string }> = [
  { label: "Overview", href: "/app/overview", icon: LayoutDashboard, group: "Operate" },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Approvals", href: "/app/approvals", icon: ClipboardCheck },
  { label: "Transactions", href: "/app/transactions", icon: ReceiptText },
  { label: "Cards & fiat", href: "/app/cards", icon: CreditCard, group: "Money" },
  { label: "Invoices", href: "/app/invoices", icon: FileText },
  { label: "Cross-chain", href: "/app/cross-chain", icon: Repeat2 },
  { label: "Marketplace", href: "/app/marketplace", icon: Store, group: "Build" },
  { label: "Resources", href: "/app/resources", icon: Boxes },
  { label: "Automations", href: "/app/automations", icon: GitBranch },
  { label: "Intelligence", href: "/app/intelligence", icon: BrainCircuit, group: "Review" },
  { label: "Audit", href: "/app/audit", icon: FileClock },
  { label: "Settings", href: "/app/settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [operatorEmail, setOperatorEmail] = useState("Loading operator…");

  useEffect(() => {
    void fetch("/api/v1/session")
      .then((response) => response.ok ? response.json() : null)
      .then((body: { data?: { user?: { email?: string } } } | null) => {
        setOperatorEmail(body?.data?.user?.email ?? "Signed-in operator");
      });
  }, []);
  return (
    <div className="app-shell">
      {navOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar${navOpen ? " sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-brand">
          <Image
            src="/brand/agentpay-lockup-white.png"
            alt="AgentPay"
            width={177}
            height={35}
            priority
          />
          {/* <span>Control</span> */}
        </div>
        <nav className="nav-list">
          {navigation.map((item) => <div className="nav-entry" key={item.href}>{item.group && <span className="nav-group">{item.group}</span>}<Link className={`nav-link${pathname === item.href || (item.href !== "/app/overview" && pathname.startsWith(`${item.href}/`)) ? " active" : ""}`} href={item.href} onClick={() => setNavOpen(false)}><item.icon aria-hidden="true" size={17} />{item.label}</Link></div>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-context">
          <span className="context-label">Environment</span>
          <span className="context-value"><span className="status-dot" />Hedera Testnet · Live</span>
        </div>
        <div className="sidebar-context">
          <span className="context-label">Operator</span>
          <span className="context-value">{operatorEmail}</span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="mobile-nav-button" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}><Menu size={20} /></button>
            <span className="topbar-title">Payment operations</span>
          </div>
          <div className="topbar-actions">
            <span className="network-label"><span className="status-dot" /><span>Hedera testnet</span></span>
            <HederaWalletConnect />
            <Link className="primary-button" href="/app/agents/new"><Plus size={16} /><span>Create agent</span></Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

export const shellIcons = { Activity, CircleDollarSign, ShieldCheck };
