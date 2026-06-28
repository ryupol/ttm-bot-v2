# Reuse First Account Design

## Goal

Allow one configured TTM account to launch multiple bot browser profiles.

## Design

`config/accounts.yaml` gets `reuse_first_account: true`. When enabled, startup can create any requested bot count from the first account entry. Each bot keeps its own bot id and persistent profile path, but all bots resolve the same email, password, and citizen id environment variables.

Default behavior stays unchanged when `reuse_first_account` is absent or false. Existing multi-account configs still map bot 1 to account 1, bot 2 to account 2, and so on.

## Config

```yaml
reuse_first_account: true
accounts:
  - id: 1
    email_env: ACCOUNT_EMAIL
    pass_env: ACCOUNT_PASS
    citizen_id_env: ACCOUNT_CITIZEN_ID
```

With that config:

```bash
npm run start -- --bots 5
```

starts bot ids 1 through 5, all using the first account credentials.

## Validation

Tests cover schema loading and selection behavior. Typecheck must pass.
