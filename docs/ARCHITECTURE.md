# Layered controller and read-only status

The PC controller, backup engine, public status projection and maintenance UI have different responsibilities and privileges.

| Layer | Implementation | Responsibility |
|---|---|---|
| Source protection and backup engine | `lib/snapshot.mjs`, `lib/restic.mjs`, `phone/job.mjs` | Independent copies, SQLite Online Backup, encrypted upload and isolated restore verification |
| Control and orchestration | `phone/serve.mjs`, `pc/control/` | Fixed probe/backup endpoints, mTLS, source identity, repository checks and restore acceptance |
| Public status projection | `lib/status.mjs` | Read local marker/status/verified records and return an allowlisted summary |
| Human maintenance | Separate [DSH-Remote-Files](https://github.com/kirigayakazima/DSH-Remote-Files) project | Browse explicitly registered live files and consume the optional Vault status projection |

## Stable CLI, explicit modules

`pc/vault.mjs` remains the CLI and scheduled-task entry point. Existing commands retain their paths.

| Module | Responsibility |
|---|---|
| `pc/control/commands.mjs` | Dispatch, configuration/identity validation, coordination lock and existing management commands |
| `pc/control/context.mjs` | Explicit private context, on-demand DPAPI and restic access, atomic JSON saves |
| `pc/control/discovery.mjs` | Private-network discovery and authenticated probe |
| `pc/control/initialize.mjs` | Existing certificate and repository initialization |
| `pc/control/backup.mjs` | Existing due-time checks, receiver lifetime, backup, repository verification and isolated restore |

Importing the control modules does not start the controller or listeners. The scheduled flag is passed explicitly. No general file or shell endpoint is added to the phone Vault service.

## Public status contract

```powershell
node pc/vault.mjs status-summary config.local.json
```

Alternatively import `readVaultStatus(dataRoot, deviceId)` from `lib/status.mjs` in a trusted local PC process.

The schema-1 `vault-status` object contains device identity, observation/attempt timestamps, result/error code, the last known verified snapshot ID/time/file and byte counts, and pointer-match status. Unknown raw fields are never forwarded. It contains no repository path, private key, DPAPI blob, conversation or memory body.

The projection does not decrypt secrets, run restic, contact the phone, acquire the coordinator lock, create scratch data or update status records, including when a read fails. The original `status` command is a private diagnostic view and must not be used as a public HTTP payload.

A restore point must exist in `verified.json`. Prefer a valid explicit last-success pointer; otherwise select a known verified record. Never infer verification from restic latest or a successful upload request. `phoneOnline` is a stored observation, not a live probe performed by this command.

This interface is consumed locally by the optional Remote Files PC proxy. It is not a network status service or a protocol that transfers Vault credentials to Heart.

## Validation scope and unchanged engine

The four fingerprinted files were not modified by this controller refactor. Their combined digest remains `30583cfd9e4d64e2cfda0bc1b7123baf69e3487cea405fdc75cb63653f984f1b`.

Local synthetic tests cover projection allowlisting, read-only CLI behavior, atomic saves and imports, alongside the existing source-shape, version-gate, real restic/rest-server, interruption/retry, isolated restore, DPAPI and mTLS tests. This update does not itself constitute a fresh production backup, native Android audit or disaster-recovery acceptance.

Before using a changed controller in production, perform the required controlled backup/isolated restore and native before/after audit. Automatic-task installation still requires the existing current-build acceptance gate. Readable Proot files and matching content hashes do not prove native source type, inode, links, owner, mode or SELinux preservation.

## Evolution

1. Keep the backup engine and its fixed control API separate from live browsing.
2. Add future PC history browsing using an explicitly verified snapshot ID, with source/time labels distinct from the live phone view.
3. Add optional authenticated status-to-Heart metadata only after defining freshness and replay behavior. Heart absence or quiet hours must not disable existing authorized disaster recovery indefinitely.
4. Add business viewers such as bounded session parsing or SQLite consistent-copy queries in the maintenance project, not as a general Vault source-file endpoint.
