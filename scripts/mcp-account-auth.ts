import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { recoverMessageAddress, type Hex } from 'viem';
import { sendNotify } from '../packages/notify/dist/index.js';

const pending = new Map<string, { email: string; wallet: string; code: string; message: string; query: string; exp: number; attempts: number }>();
const recent = new Map<string, number>();
const cookieName = 'bagseven_mcp_account_challenge';
const fingerprint = (req: Request) => createHash('sha256').update(JSON.stringify(Object.entries(req.query).sort())).digest('hex');

export async function startAccountConsent(req: Request, res: Response, origin: string) {
  if (req.headers.origin !== origin) return res.status(403).json({ error: 'Open the consent page again.' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^0x[\da-f]{40}$/.test(wallet)) return res.status(400).json({ error: 'Enter an email and connect your wallet.' });
  const now = Date.now();
  for (const [key, value] of pending) if (value.exp <= now) pending.delete(key);
  for (const [key, value] of recent) if (value + 60000 <= now) recent.delete(key);
  if (pending.size >= 5000 || (recent.get(email) ?? 0) + 15000 > now) return res.status(429).json({ error: 'Wait before requesting another code.' });
  recent.set(email, now);
  const id = randomUUID(), code = String(randomInt(100000, 1000000)), exp = now + 600000;
  const query = fingerprint(req);
  const message = ['Bagseven Avalanche agent connection', `Website: ${origin}`, `Email: ${email}`, `Wallet: ${wallet}`,
    `Authorization request: ${query}`, `Nonce: ${id}`, `Expires: ${new Date(exp).toISOString()}`,
    'Approve this agent connection. Spending still requires a separate owner-signed mandate.'].join('\n');
  const sent = await sendNotify({ to: email, event: 'magic_link', subject: 'Your Bagseven agent connection code',
    title: 'Approve your agent connection', body: `Your verification code is ${code}. It expires in 10 minutes.` });
  if (!sent.ok || sent.skipped) return res.status(503).json({ error: 'Email delivery is unavailable. Try again later.' });
  pending.set(id, { email, wallet, code, message, query, exp, attempts: 0 });
  res.cookie(cookieName, id, { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/oauth', maxAge: 600000 });
  return res.json({ message });
}

export async function finishAccountConsent(req: Request, res: Response, origin: string) {
  if (req.headers.origin !== origin) throw Error('Open the consent page again.');
  const id = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const challenge = id ? pending.get(id) : undefined;
  if (!id || !challenge || challenge.exp <= Date.now() || challenge.query !== fingerprint(req)) throw Error('Connection verification expired or belongs to another request.');
  challenge.attempts++;
  if (challenge.attempts > 5) { pending.delete(id); throw Error('Too many attempts. Request a new code.'); }
  if (typeof req.body?.code !== 'string' || req.body.code.trim() !== challenge.code) throw Error('Invalid email code.');
  pending.delete(id);
  res.clearCookie(cookieName, { path: '/oauth' });
  const signature = req.body?.signature;
  if (typeof signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(signature)) throw Error('Wallet signature required.');
  const signer = await recoverMessageAddress({ message: challenge.message, signature: signature as Hex });
  if (signer.toLowerCase() !== challenge.wallet) throw Error('The signature does not match the connected wallet.');
  return { accountId: challenge.email, wallet: challenge.wallet };
}

export const accountConsentMarkup = `<p>Confirm your email and sign with your Avalanche wallet to connect this agent.</p>
<form id="account-form" method="post">
<label>Email<input id="email" name="email" type="email" required autocomplete="email" /></label>
<button id="send-code" type="button">Connect wallet and send code</button>
<label>Email code<input name="code" inputmode="numeric" autocomplete="one-time-code" required /></label>
<input id="account-signature" name="signature" type="hidden" />
<button id="approve" type="button" disabled>Sign and approve connection</button><p id="status" role="status"></p></form>
<script>
let ownershipMessage;
const status = document.getElementById('status');
document.getElementById('account-form').action = '/oauth/authorize' + location.search;
document.getElementById('send-code').onclick = async function() {
 this.disabled = true;
 try {
  if (!window.ethereum) throw Error('Connect an Avalanche-compatible browser wallet first.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const response = await fetch('/oauth/account/challenge' + location.search, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ email: document.getElementById('email').value, wallet: accounts[0] })});
  const result = await response.json(); if (!response.ok) throw Error(result.error);
  ownershipMessage = { message: result.message, wallet: accounts[0] };
  document.getElementById('approve').disabled = false; status.textContent = 'Check your email for the code.';
 } catch(error) { status.textContent = error.message; } finally { this.disabled = false; }
};
document.getElementById('approve').onclick = async function() {
 this.disabled = true;
 try {
  if (!document.getElementById('account-form').reportValidity()) return;
  const encoded = '0x' + Array.from(new TextEncoder().encode(ownershipMessage.message)).map(v=>v.toString(16).padStart(2,'0')).join('');
  document.getElementById('account-signature').value = await window.ethereum.request({method:'personal_sign',params:[encoded,ownershipMessage.wallet]});
  document.getElementById('account-form').submit();
 } catch(error) { status.textContent = error.message; } finally { this.disabled = false; }
};
</script>`;
