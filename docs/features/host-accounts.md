# Feature: Host accounts

## Purpose

Connect GitHub, GitLab, or Bitbucket with a personal access token (or app password), list remote repositories, and feed clone URLs into the clone flow. An optional separate OAuth broker exists for confidential-client flows; the desktop app connects via `providers:save-token` (PAT / app password).

## User flow

1. Open Accounts modal → choose provider → paste token (Bitbucket may need username).
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
- Listed accounts never include plaintext tokens over IPC.
- If `safeStorage` is unavailable, tokens fall back to base64 encoding (weaker) — same helpers still used.
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
