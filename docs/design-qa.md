# Product UI and Design QA

AgentPay is a financial control interface. UI quality is therefore measured not only by visual consistency but by whether users can understand authority, risk, state, and evidence without ambiguity.

## Information hierarchy

Primary financial screens should make these fields easy to distinguish:

- organization/workspace;
- agent/payment identity;
- amount, asset, network/provider;
- resource/merchant/invoice purpose;
- policy result;
- approval state;
- submission state;
- settlement/transfer completion evidence;
- reconciliation state;
- timestamps and audit trail.

## State language

Never collapse materially different states into a generic success/failure badge.

Required distinctions include:

- denied;
- approval pending;
- authorized but not submitted;
- submitted/processing;
- submission unknown / reconciliation required;
- settled/completed;
- payment settled but fulfillment failed;
- provider/profile not configured;
- Sandbox/development provider state.

A Moove `ACTIVE` link is not paid. A card/fiat provider request being accepted is not a terminal transfer. A blockchain submission response is not final confirmation unless the rail's evidence rule is satisfied.

## Provider readiness

Provider-backed pages should display configuration/readiness without exposing secret values. Avoid presenting disabled or Sandbox functionality as production financial capability.

## Secret handling

The UI must not render/log:

- agent credential secrets after their intended one-time reveal;
- blockchain private keys/test derivation secrets;
- provider restricted keys/webhook secrets;
- external custody credentials;
- database/session secrets;
- raw card PAN/CVC.

Provider-authorized short-lived card-display flows should be isolated from ordinary application data and never persisted by AgentPay.

## Approval UX

Approval screens must show enough context for a deliberate decision: requesting agent, amount/asset/network, payee/resource/purpose, policy reason, expiry, prior decisions, and threshold state. Destructive/financial decisions should not use ambiguous copy.

## Reconciliation UX

Pending/ambiguous operations should explain that the system is checking authoritative provider/network evidence and that creating another payment may duplicate the side effect. Operators should have identifiers/evidence needed for investigation without seeing secrets.

## Emergency controls

Kill-switch UI must communicate scope and effect clearly. Activation/deactivation should require appropriate authorization and provide confirmation/audit feedback.

## Forms

- preserve input focus and values across validation/render cycles;
- use explicit labels and field-level error text;
- prevent duplicate financial submission while request is in flight;
- preserve the same idempotency key when retrying the same intended operation;
- require deliberate confirmation for destructive actions;
- use sensible disabled/loading states.

## Accessibility

- keyboard-operable interactive controls;
- visible focus states;
- semantic labels/headings;
- error/status information not conveyed by color alone;
- sufficient contrast;
- screen-reader-accessible dialogs/tables/forms;
- reduced-motion behavior where animation exists;
- responsive layouts for narrow screens without hiding material financial context.

## Tables and transaction views

Large tables should prioritize scanability, filters, pagination, and stable state labels. Long addresses/transaction IDs should be copyable and visually truncated without altering their actual value.

## Empty/loading/error states

Financial pages must differentiate:

- no records yet;
- feature not configured;
- provider unavailable;
- authorization denied;
- data still loading;
- reconciliation pending;
- true application error.

## Responsive QA

Test dashboard navigation, policy editors, approval modals, transaction details, invoices, cards, marketplace, automation, and intelligence views at desktop and mobile widths. Financial context must not disappear simply because the viewport is small.

## Release visual QA

Before production promotion:

- verify all primary pages load without console/runtime errors;
- test keyboard navigation and dialogs;
- inspect long/empty/error/loading content;
- verify no secrets are present in DOM/server-rendered payloads;
- verify state labels match backend truth;
- verify enabled/disabled provider capability messaging;
- test destructive confirmation paths;
- run browser smoke/e2e checks configured for the release.
