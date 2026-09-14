# Feature: Host accounts

## Purpose

Connect GitHub or GitLab with a personal access token, or Bitbucket with an Atlassian API token and account email; list remote repositories and feed clone URLs into the clone flow. An optional separate OAuth broker exists for confidential-client flows; the desktop app connects via `providers:save-token`.

## User flow

1. Open Accounts modal → choose provider → paste token (Bitbucket also needs the Atlassian account email; API calls use HTTP Basic auth with email + API token).
2. Token is validated against the host `/user` API; account metadata is stored; token encrypted at rest.
3. List remote repos for the selected account; pick one to clone (HTTPS or SSH URL).
4. Disconnect removes the account record (and encrypted token).

## Key modules & files

| Piece | File |
|---|---|
| Accounts UI | [`src/renderer/src/features/accounts/AccountsModal.tsx`](../../src/renderer/src/features/accounts/AccountsModal.tsx) |
| Provider REST | [`src/main/providers/index.ts`](../../src/main/providers/index.ts) |
| Token storage | [`src/main/storage.ts`](../../src/main/storage.ts) |
| IPC | [`src/main/ipc/providers-handlers.ts`](../../src/main/ipc/providers-handlers.ts) (`providers:*`) |
| OAuth broker | [`services/oauth-broker/server.ts`](../../services/oauth-broker/server.ts) |

## Data touched

- `accounts.json` (`ProviderAccount` + `tokenEnc`)
- Host REST APIs (user + repos)
- Clone creates a local `Repository`

## Edge cases & rules

- Desktop IPC exposes `listAccounts`, `saveToken`, `disconnect`, and `listRepos` only — no in-app OAuth code exchange yet (use the optional broker for confidential clients).
- Listed accounts never include plaintext tokens (or the stored Bitbucket email) over IPC.
- Repository lists follow pagination up to 10 pages (1,000 repositories); each host request times out after 20 seconds.
- Bitbucket accounts saved without an email (app-password era) must be reconnected.
- Without OS encryption (`safeStorage` unavailable, or the Linux `basic_text` backend), tokens are stored base64-encoded and the account is marked "token stored without OS encryption" in the Accounts dialog.
- Broker does not store long-lived user tokens; it only exchanges codes.

## Diagram

```mermaid
sequenceDiagram
  actor User
  participant UI as AccountsModal
  participant Main as Main IPC
  participant Prov as providers
  participant Host as Host API
  User->>UI: saveToken
  UI->>Main: providers.saveToken
  Main->>Prov: connectWithToken
  Prov->>Host: GET /user
  Host-->>Prov: profile
  Main->>Main: storeAccountToken
  Main-->>UI: ProviderAccount
  User->>UI: list repos
  UI->>Main: providers.listRepos
  Main->>Prov: listRemoteRepos
  Prov->>Host: list repos
  Host-->>UI: RemoteRepo[]
```
