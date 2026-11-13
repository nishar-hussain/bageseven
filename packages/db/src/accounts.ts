import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { accountProfiles } from './schema/index.js';

/** Durable authority profile; cookies authenticate email but do not replace this record. */
export class AccountProfiles {
  constructor(private db: Database) {}
  async get(email: string) {
    const [row] = await this.db.select().from(accountProfiles).where(eq(accountProfiles.email, email.toLowerCase()));
    return row ?? null;
  }
  async ensure(email: string) {
    await this.db.insert(accountProfiles).values({ email: email.toLowerCase() }).onConflictDoNothing();
    return (await this.get(email))!;
  }
  async bind(email: string, expected: string | null, wallet: string) {
    await this.ensure(email);
    const [row] = await this.db.update(accountProfiles).set({ walletAddress: wallet.toLowerCase(), updatedAt: new Date() })
      .where(and(eq(accountProfiles.email, email.toLowerCase()), expected
        ? eq(accountProfiles.walletAddress, expected.toLowerCase()) : isNull(accountProfiles.walletAddress))).returning();
    if (!row) throw Error('ACCOUNT_CHANGED: wallet binding changed; sign in and verify again');
    return row;
  }
  async complete(email: string, wallet: string, at: number) {
    const [row] = await this.db.update(accountProfiles).set({ onboardingDoneAt: at, updatedAt: new Date() })
      .where(and(eq(accountProfiles.email, email.toLowerCase()), eq(accountProfiles.walletAddress, wallet.toLowerCase()))).returning();
    if (!row) throw Error('ACCOUNT_CHANGED: verify the current wallet before completing setup');
    return row;
  }
}
