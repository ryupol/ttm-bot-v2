import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import {
  AccountFileSchema,
  type AppConfig,
  type ResolvedAccount,
  ConcertSchema,
  SettingsSchema,
} from "./schema.ts";
import type { AccountRouting } from "./accounts.ts";

export type LoadOptions = {
  rootDir?: string;
  settingsPath?: string;
  accountsPath?: string;
  concertPath?: string;
};

export function loadAppConfig(options: LoadOptions = {}): {
  config: AppConfig;
  accounts: ResolvedAccount[];
  accountRouting: AccountRouting;
} {
  const rootDir = options.rootDir ?? process.cwd();
  dotenv.config({ path: path.join(rootDir, "secrets", ".env"), override: false });

  const settingsPath = resolvePath(rootDir, options.settingsPath ?? "config/settings.yaml");
  const accountsPath = resolvePath(rootDir, options.accountsPath ?? "config/accounts.yaml");
  const concertPath = resolvePath(rootDir, options.concertPath ?? "config/concert.yaml");

  const settings = SettingsSchema.parse(readYaml(settingsPath));
  const accountFile = AccountFileSchema.parse(readYaml(accountsPath));
  const concert = ConcertSchema.parse(readYaml(concertPath));

  const accounts = accountFile.accounts.map(resolveAccount);
  assertConfiguredEnvVarsResolve(accounts, settings);

  return {
    config: { rootDir, settings, concert },
    accounts,
    accountRouting: { reuseFirstAccount: accountFile.reuse_first_account },
  };
}

function assertConfiguredEnvVarsResolve(accounts: ResolvedAccount[], settings: { telegram: { enabled: boolean; token_env: string; chat_id_env: string } }): void {
  const missing: string[] = [];
  for (const account of accounts) {
    if (account.email_env && !account.email) missing.push(`${account.email_env} (account ${account.id} email)`);
    if (account.pass_env && !account.password) missing.push(`${account.pass_env} (account ${account.id} password)`);
    if (account.citizen_id_env && !account.citizenId) missing.push(`${account.citizen_id_env} (account ${account.id} citizen id)`);
  }
  if (settings.telegram.enabled) {
    if (!process.env[settings.telegram.token_env]) missing.push(`${settings.telegram.token_env} (telegram token)`);
    if (!process.env[settings.telegram.chat_id_env]) missing.push(`${settings.telegram.chat_id_env} (telegram chat id)`);
  }
  if (missing.length > 0) {
    throw new Error(`Missing env vars referenced by config: ${missing.join(", ")}. Check secrets/.env`);
  }
}

function readYaml(filePath: string): unknown {
  return YAML.parse(readFileSync(filePath, "utf8"));
}

function resolvePath(rootDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
}

function resolveAccount(account: AccountFileSchemaOutput): ResolvedAccount {
  return {
    ...account,
    email: account.email_env ? process.env[account.email_env] : undefined,
    password: account.pass_env ? process.env[account.pass_env] : undefined,
    citizenId: account.citizen_id_env ? process.env[account.citizen_id_env] : undefined,
  };
}

type AccountFileSchemaOutput = ReturnType<typeof AccountFileSchema.parse>["accounts"][number];
