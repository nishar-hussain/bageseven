'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, CreditCard, ShieldCheck } from 'lucide-react';

const flows = [
  { id: 'access', title: 'Prepaid access', icon: CheckCircle2, description: 'Use credits the customer has already paid for. No new USDT transfer and no funded mandate required.',
    steps: [{ label: 'Application or agent', detail: 'SDK request or MCP paid_run' }, { label: 'Daemon', detail: 'Authenticate and check holder / worker scope' }, { label: 'Arkiv grant', detail: 'Check enabled, expiry, and credit balance' }, { label: 'Consume credits', detail: 'Meter the feature with an idempotency key' }, { label: 'Feature access', detail: 'Your service honors the access result' }],
    truth: 'Authority: the living entitlement and its remaining service credits.' },
  { id: 'checkout', title: 'Customer checkout', icon: CreditCard, description: 'The customer pays the provider directly. The backend verifies payment evidence before creating access.',
    steps: [{ label: 'Plan and session', detail: 'Provider, holder, price, and feature' }, { label: 'Customer wallet', detail: 'Approve the configured USDT transfer' }, { label: 'Whitechain', detail: 'USDT settles to the provider wallet' }, { label: 'Daemon verification', detail: 'Verify receipt, payer signature, and payment reuse' }, { label: 'Arkiv entitlement', detail: 'Create credits and a paid-through time' }],
    truth: 'Authority: verified payment evidence, followed by a living grant. The separate 0.1% provider fee is recorded, not split from this transfer.' },
  { id: 'payment', title: 'New agent payment', icon: ShieldCheck, description: 'Spend USDT within an owner-authorized budget. The required grant and the mandate must both permit the operation.',
    steps: [{ label: 'MCP agent', detail: 'Request bagseven_fetch payment' }, { label: 'Daemon', detail: 'Resolve active worker and payment entitlement' }, { label: 'Policy', detail: 'Verify signed intent and reserve authorization' }, { label: 'Mandate contract', detail: 'Enforce caps, vault funds, and worker allocation' }, { label: 'Settle and meter', detail: 'Execute payment and update the request / grant state' }],
    truth: 'Authority: a living payment entitlement plus on-chain spending limits. A database active flag alone is insufficient.' },
];

export function ArchitectureDiagram() {
  const [selected, setSelected] = useState(0);
  const flow = flows[selected];
  return <div className="docs-architecture">
    <div role="tablist" aria-label="Architecture request flow" className="docs-flow-tabs">{flows.map((item, index) => {
      const Icon = item.icon;
      return <button type="button" role="tab" id={`flow-tab-${item.id}`} key={item.id} aria-selected={selected === index} aria-controls="docs-flow-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => {
        let target: number;
        if (event.key === 'ArrowRight') target = (index + 1) % flows.length;
        else if (event.key === 'ArrowLeft') target = (index + flows.length - 1) % flows.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = flows.length - 1;
        else return;
        event.preventDefault(); setSelected(target); document.getElementById(`flow-tab-${flows[target].id}`)?.focus();
      }}><Icon size={15} />{item.title}</button>;
    })}</div>
    <div role="tabpanel" id="docs-flow-panel" aria-labelledby={`flow-tab-${flow.id}`} tabIndex={0} className="docs-flow-panel">
      <p>{flow.description}</p>
      <ol className="docs-flow-chain">{flow.steps.map((step, index) => <li key={step.label}><div><span className="docs-flow-number">{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><small>{step.detail}</small></div>{index < flow.steps.length - 1 && <ArrowRight size={16} aria-hidden="true" />}</li>)}</ol>
      <div className="docs-flow-truth">{flow.truth}</div>
    </div>
  </div>;
}
