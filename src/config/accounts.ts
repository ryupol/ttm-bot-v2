import type { ResolvedAccount } from "./schema.ts";

export type AccountRouting = {
  reuseFirstAccount: boolean;
};

export function selectBotAccounts(
  accounts: ResolvedAccount[],
  options: { botCount?: number; reuseFirstAccount?: boolean } = {},
): ResolvedAccount[] {
  const botCount = options.botCount ?? Math.min(accounts.length, 5);
  if (!options.reuseFirstAccount) return accounts.slice(0, botCount);

  const firstAccount = accounts[0];
  if (!firstAccount) return [];

  return Array.from({ length: botCount }, (_, index) => ({
    ...firstAccount,
    id: index + 1,
  }));
}
