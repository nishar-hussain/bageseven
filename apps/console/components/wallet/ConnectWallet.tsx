'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSignMessage } from 'wagmi';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Wallet, ChevronDown, ShieldCheck, ArrowRightLeft } from 'lucide-react';
import { errorMessage } from '../../lib/error-message';
import { withWalletOperation, getWalletOperation, subscribeWalletOperation } from '../../lib/bagseven-sdk-wallet';
import styles from './wallet.module.css';
import { useAccountWallet, announceAccountUpdate } from './AccountWallet';
import { accountWalletState } from '../../lib/account-wallet-state';
import { WalletReplacement } from './WalletReplacement';

type Props = {
  /** Compact for headers / embed chrome */
  compact?: boolean;
  /** Persist connected address to console account when signed in */
  persistToAccount?: boolean;
  className?: string;
  onConnected?: (address: `0x${string}`) => void;
  onLinked?: (address: `0x${string}`) => void;
  onLinkError?: (message: string) => void;
};

/**
 * RainbowKit connect control. Prefer Avalanche Fuji (43113).
 * Persisted accounts require an explicit ownership signature, never just a pasted address.
 */
export function ConnectWallet({ compact = false, persistToAccount = false, className, onConnected, onLinked, onLinkError }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const account = useAccountWallet();
  const linked = account.profile?.wallet_address;
  const state = accountWalletState({ loaded: account.loaded, failed: Boolean(account.error), linked, connected: isConnected ? address : null });
  const [replacing, setReplacing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState('');
  const [linkError, setLinkError] = useState(false);
  const verified = state === 'verified';

  useEffect(() => { setMessage(''); setLinkError(false); setReplacing(false); }, [address, linked]);

  useEffect(() => {
    if (!isConnected || !address) return;
    onConnected?.(address);
  }, [address, isConnected, onConnected]);

  const linkWallet = async () => {
    if (!address || linking) return;
    setLinking(true);
    setLinkError(false);
    setMessage('Approve the wallet ownership signature.');
      try {
        await withWalletOperation('Verify wallet ownership', async () => {
        const challenge = await fetch(`/api/auth/wallet/verify?owner=${encodeURIComponent(address)}`, { cache: 'no-store' });
        const payload = (await challenge.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
        if (!challenge.ok || !payload.message) throw new Error(payload.error?.message || 'Could not prepare wallet verification');
        const signature = await signMessageAsync({ message: payload.message });
        const verified = await fetch('/api/auth/wallet/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signature }),
        });
        const result = (await verified.json().catch(() => ({}))) as { wallet_address?: `0x${string}`; error?: { message?: string } };
        if (!verified.ok || !result.wallet_address) throw new Error(result.error?.message || 'Wallet ownership could not be verified');
        await account.refresh();
        announceAccountUpdate();
        setMessage('Wallet ownership verified.');
        onLinked?.(result.wallet_address);
        });
      } catch (error) {
        const detail = errorMessage(error, 'Wallet ownership could not be verified');
        setLinkError(true);
        setMessage(detail);
        onLinkError?.(detail);
      } finally {
        setLinking(false);
      }
  };

  return (
    <div className={`min-w-0 max-w-full ${className ?? ''}`}>
      <WalletControl compact={compact} />
      {persistToAccount && state === 'loading' && <p role="status" className={styles.message}>Loading your saved wallet…</p>}
      {persistToAccount && state === 'unavailable' && <p role="alert" className={styles.error}>{account.error} <button type="button" onClick={() => void account.refresh()}>Retry</button></p>}
      {persistToAccount && state === 'reconnect' && <p className={styles.message}>Your account is still linked to <code>{linked}</code>. Reconnect that wallet to continue; disconnecting does not unlink it.</p>}
      {persistToAccount && state === 'different' && <div className={styles.replacement}>
        <p>Your account is linked to <code>{linked}</code>, but a different wallet is connected. Switch accounts in your wallet to reconnect it, or explicitly replace the linked wallet.</p>
        {!replacing ? <button type="button" className={styles.verify} onClick={() => setReplacing(true)}>Replace linked wallet</button> : account.profile?.email && address && <WalletReplacement key={address + linked + account.profile.email} email={account.profile.email} address={address} onVerified={linkWallet} onCancel={() => setReplacing(false)} />}
      </div>}
      {persistToAccount && isConnected && address && (state === 'unlinked' || verified) && account.profile?.email_verified ? (
        <button type="button" disabled={linking || verified} onClick={() => void linkWallet()}
          className={styles.verify}>
          <ShieldCheck size={14} />{linking ? 'Waiting for signature…' : verified ? 'Ownership verified' : 'Verify wallet ownership'}
        </button>
      ) : null}
      {message ? <p role={linkError ? 'alert' : 'status'} className={linkError ? styles.error : styles.message}>{message}</p> : null}
    </div>
  );
}

/** Shared console and embedded wallet controls; wallet approval stays with the user. */
const idleWallet = { active: null, reminder: null };
function WalletControl({ compact = false }: { compact?: boolean }) {
  const accountProfile = useAccountWallet();
  const operation = useSyncExternalStore(subscribeWalletOperation, getWalletOperation, () => idleWallet);
  const blocked = Boolean(operation.active || operation.reminder);
  return <ConnectButton.Custom>{({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
    if (!mounted || !accountProfile.loaded) return <button className={styles.connect} type="button" disabled aria-busy="true"><Wallet size={16} />Loading wallet…</button>;
    if (!account || !chain) return <button className={styles.connect} type="button" disabled={blocked} onClick={openConnectModal}><Wallet size={16} />{accountProfile.profile?.wallet_address ? 'Reconnect wallet' : 'Connect wallet'}</button>;
    const short = account.address.slice(0, 6) + '…' + account.address.slice(-4);
    return <div className={styles.controls}>
      <button className={chain.unsupported ? styles.wrongNetwork : styles.network} type="button" disabled={blocked} onClick={openChainModal} aria-label={chain.unsupported ? 'Wrong network. Switch to Avalanche Fuji' : 'Avalanche Fuji. Change network'}>
        {chain.unsupported ? <ArrowRightLeft size={14} /> : <span className={styles.networkDot} />}{chain.unsupported ? 'Switch to Fuji' : compact ? 'Fuji' : 'Avalanche Fuji'}<ChevronDown size={12} />
      </button>
      <button className={styles.account} type="button" onClick={openAccountModal} aria-label={'Manage wallet ' + account.address}>
        <Wallet size={15} /><span>{short}</span><ChevronDown size={12} />
      </button>
    </div>;
  }}</ConnectButton.Custom>;
}
export function EmbedWalletBar() { return <WalletControl compact />; }
