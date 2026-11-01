# DSH-Vault

> **Zero-hardlink, append-only, mTLS-authenticated encrypted backup and multi-key disaster recovery system for mobile AI agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=24](https://img.shields.io/badge/Node->=24-green.svg)](https://nodejs.org/)
[![Tests: 25 Passed](https://img.shields.io/badge/Tests-25%2F25%20Passed-brightgreen.svg)](#-testing--verification)
[![Restic: 0.19.1](https://img.shields.io/badge/Restic-0.19.1-orange.svg)](https://restic.net/)

---

## 🌟 Overview

Mobile AI agents running inside mobile Linux containers (such as **Android proot**, **Termux**, or **Cordis/DSHA** runtimes) accumulate irreplaceable digital memories: long-term memory graphs, vector insights, daily conversation transcripts, and personality traits.

However, mobile environments face severe challenges:
1. **Host-Container Boundary Fragility**: Naive file copying or hardlinking (`linkSync`) inside virtualized proot environments generates host-incompatible L2S link files, risking host filesystem corruption.
2. **Active SQLite Database Corruption**: Copying active SQLite WAL databases while an agent is actively thinking or writing causes database locking and malformed pages.
3. **Privacy & Single-Point Key Failure**: Traditional cloud backups risk exposing highly confidential conversation logs. Conversely, relying solely on local Windows DPAPI machine keys means a motherboard failure or OS reinstall renders backups permanently unrecoverable.

**DSH-Vault** provides local, zero-hardlink, append-only, deduplicated encrypted backup with isolated restore verification. Readable container files and matching content hashes do not replace Android native source-shape or production recovery acceptance.

---

## 🛡️ Key Architectural Features

- **Zero-Hardlink Atomic Snapshotting**:  
  Creates independent temporary copies and atomically replaces staging entries. Before/after byte and file-identity checks protect the source; Android native type, links, owner, mode and SELinux state still require separate verification.
- **SQLite Online Backup Integration**:  
  Uses the native Node.js SQLite Online Backup API (`sqlite3_backup`) to snapshot active databases safely, switches clones to `DELETE` journal mode, and executes `PRAGMA integrity_check` before packaging.
- **Mutual TLS (mTLS) & Source Fingerprint Verification**:  
  PC and mobile device authenticate mutually using dedicated RSA-4096 certificates. PC controllers verify the mobile agent's runtime source SHA-256 digest before authorizing any backup transfer.
- **Append-Only Network Storage**:  
  The mobile agent pushes encrypted snapshots to a temporary on-demand `rest-server` running on the PC. The mobile client is granted **append-only** permissions—it cannot overwrite or purge historical snapshots.
- **Multi-Key Disaster Recovery (`manage-emergency-key.mjs`)**:  
  Built on industrial-grade **restic**. Supports multiple keys per repository:
  1. *System Key*: Hardware-protected via Windows DPAPI for silent, hands-free automated backup.
  2. *Personal Emergency Key*: Users can bind a separately retained recovery password for recovery with standard restic on another supported computer. Files, credentials and platform-bound keys have distinct portability limits.
- **Isolated Unprivileged Dry-Run Restore Verification**:  
  Every backup is automatically test-restored to an isolated sandbox on the PC to verify file hashes, SQLite integrity, and session counts before registering as a `verified` restore point.

---

## 📂 Architecture Diagram

```text
  [ Mobile Agent Device ]                             [ Home PC / Server ]
  (Android proot / Termux)                            (Windows / Linux)
+--------------------------+                        +--------------------------+
|  Active Agent Workspace  |                        |   DSH-Vault Controller   |
|  - SQLite Databases      |                        |  - secrets.dpapi / Key   |
|  - Memory / Sessions     |                        |  - status.json           |
+-------------+------------+                        +-------------+------------+
              |                                                   |
              | (SQLite Online Backup + Atomic Stage)             | (1. mTLS Probe)
              v                                                   v
+--------------------------+      mTLS / REST (TLS) + creds +--------------------------+
|  Mobile Vault Service    | =============================> |  On-Demand rest-server   |
|  (serve.mjs / restic)    |      Append-Only Stream        |  (Runs only during sync) |
+--------------------------+                                +-------------+------------+
                                                                          |
                                                                          | (Append-Only Blobs)
                                                                          v
                                                            +--------------------------+
                                                            | Encrypted Repository     |
                                                            | (repositories/xiaoman)   |
                                                            | - AES-256 deduplicated   |
                                                            +--------------------------+
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: version `>= 24.0.0`
- **PowerShell 7**: `pwsh.exe` on PATH for certificate creation (or set `powerShell` in configuration); tests can use `VAULT_POWERSHELL`.
- **Operating System**: Windows 10/11 (for PC controller) and Linux / Android proot / aarch64 (for mobile agent)
- **Restic & rest-server**: Restic `0.19.1` and rest-server `0.14.0`

### 2. Download Tools & Dependencies
```powershell
# Clone the repository
git clone https://github.com/kirigayakazima/DSH-Vault.git
cd DSH-Vault

# Install Node dependencies
npm ci --ignore-scripts

# Download official restic and rest-server binaries
powershell -ExecutionPolicy Bypass -File tools/download-tools.ps1
```

### 3. Configure
Copy the configuration template:
```powershell
copy config.example.json config.local.json
```
Edit `config.local.json` to specify your `dataRoot`, mobile IP address, and preferred discovery subnet.

### 4. Initialize Vault
```powershell
node pc/vault.mjs init config.local.json
```
This generates the mutual TLS certificates, initial restic repository, and local DPAPI secrets.

Phone bootstrap installation requires an independently confirmed device identity, matching the configuration used to seal the installation payload:

```sh
node phone/install-paired.mjs --device-id YOUR-CONFIGURED-DEVICE-ID
```

Do not infer the expected identity from the incoming payload. The bootstrap refuses missing, invalid or mismatched IDs and does not overwrite an existing phone installation.

### 5. Add Your Emergency Master Password
> [!IMPORTANT]
> To prevent lock-out in the event of PC hardware failure or OS reinstall, configure your own memorable disaster recovery key:

```powershell
node pc/manage-emergency-key.mjs config.local.json add
```
- Enter your memorable password when prompted.
- The tool registers the new key into the repository and verifies it immediately.

You can also export a standalone offline recovery sheet:
```powershell
node pc/manage-emergency-key.mjs config.local.json export-kit D:\emergency-kit.txt
```

---

## 🛠️ CLI Reference

### Controller Commands (`pc/vault.mjs`)

| Command | Description |
|---|---|
| `status` | Display recent backup timestamp, duration, verified snapshot ID, and sizes |
| `status-summary` | Return allowlisted local metadata without decrypting credentials, contacting the phone or modifying status |
| `backup-now` | Trigger an on-demand mTLS-authenticated incremental backup and dry-run verify |
| `list` | List all historical snapshots in the repository with verified flags |
| `verify` | Perform a full `--read-data` cryptographic check on the repository |
| `restore-dry-run` | Restore the latest snapshot to an isolated scratch sandbox to audit content |
| `retention-plan` | Calculate snapshot pruning according to the 7-day daily / 4-week weekly policy |

### Layered controller and maintenance UI

The stable CLI delegates to `pc/control/` modules for context, discovery, initialization, backup and dispatch. The four fingerprinted backup engine files remain unchanged in 0.1.1.

`lib/status.mjs` exports `readVaultStatus(dataRoot, deviceId)` for trusted local consumers. It only returns timestamps, result/error codes and known verified snapshot metadata; it does not expose paths, secrets, conversations or memory bodies. Unlike private controller commands, projection failure does not write a failed backup status.

[DSH-Remote-Files](https://github.com/kirigayakazima/DSH-Remote-Files) is the separate live file-maintenance UI and can consume this projection on the PC. Vault itself still has only the fixed phone `/probe` and `/backup` endpoints. See [architecture and evolution](docs/ARCHITECTURE.md) and [changelog](CHANGELOG.md).

### Key Management (`pc/manage-emergency-key.mjs`)

| Command | Description |
|---|---|
| `list` | List all registered keys (System key vs Custom user keys) in the repository |
| `add` | Interactively register a new user-defined recovery password |
| `export-kit [file]` | Generate a complete offline disaster recovery instruction document |
| `show-system-key` | Display the system-generated automated master key on the console |

---

## 🆘 Disaster Recovery Without DSH-Vault Code

Because DSH-Vault uses open standard **restic** for storage, you **do not** even need this repository to recover your data during a total disaster!

On any new machine (Linux, macOS, or Windows):
1. Download official restic: `https://github.com/restic/restic/releases`
2. Run:
```bash
restic -r /path/to/repositories/xiaoman restore VERIFIED_SNAPSHOT_ID --target /path/to/isolated-restore
```
3. Enter your **Emergency Master Password**.
4. Validate the isolated restore, database integrity, content and platform portability before any production recovery. Use a known verified snapshot ID; if verification records are unavailable, validate a candidate in isolation before trusting it. This repository has no production phone-restore network endpoint.

---

## 🧪 Testing & Verification

Run the full automated test suite (including synthetic restic uploads, WAL transactions, L2S link regressions, and tamper detection):

```bash
# Verify source safety (zero linkSync guard)
npm run check:safety

# Run full regression suite (25 synthetic tests)
npm test
```

The full suite uses Windows DPAPI, PowerShell 7 and the local restic/rest-server tools. Tests operate on synthetic fixtures only. They do not authorize automatic tasks or establish a fresh production backup/native Android acceptance for a changed controller.

---

## 📄 License

Licensed under the [MIT License](LICENSE).
