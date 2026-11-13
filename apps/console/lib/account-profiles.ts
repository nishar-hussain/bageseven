import { AccountProfiles, createDb } from '@bagseven/db';
let profiles: AccountProfiles | undefined;
let database: ReturnType<typeof createDb> | undefined;
export function consoleDatabase() {
  const url = process.env.CONSOLE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw Error('ACCOUNT_STORAGE_UNAVAILABLE: CONSOLE_DATABASE_URL is required');
  return database ??= createDb({ connectionString: url, max: 5 });
}
export function accountProfiles() {
  return profiles ??= new AccountProfiles(consoleDatabase());
}
