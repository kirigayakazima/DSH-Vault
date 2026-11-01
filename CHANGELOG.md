# Changelog

## 0.1.1 — 2026-11-01

- Split the PC controller into explicit context, discovery, initialization, backup and command modules while preserving `pc/vault.mjs` as the entry point.
- Add read-only `status-summary` and `lib/status.mjs` for local, allowlisted verified-backup metadata; no credential decryption, phone request or status write.
- Document the boundary with the independent DSH-Remote-Files maintenance UI.
- Add synthetic status/control regressions and preserve the four fingerprinted backup engine files unchanged.
- Remove the developer-specific PowerShell test path. Certificate tests use `VAULT_POWERSHELL` or `pwsh.exe`; example configuration requires PowerShell 7 for certificate creation.
- Bootstrap installation now requires an independently supplied `--device-id` instead of a hardcoded development device ID, and rejects missing/invalid IDs before reading installation data.

No production phone deployment, real backup, Root repair or automatic-task changes are performed by this source update. Revalidate a changed controller before production use.
