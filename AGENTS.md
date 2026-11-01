# DSH-Vault maintenance rules

- Read [the architecture and validation boundaries](docs/ARCHITECTURE.md) before changing controller behavior.
- Source files are read-only. Never create source-to-stage hardlinks or modify source ownership, permissions, timestamps or journal state.
- Write independent temporary copies before replacing staging entries. Preserve file identity and alias checks; do not reduce checks to content hashes or size/mtime.
- SQLite uses a read-only source connection and Online Backup. Normalize and check only independent copies; copying active db/WAL/SHM separately is not a consistent backup.
- Keep the phone API limited to fixed probe/backup operations. No general source-file, shell, production restore or Root repair endpoint.
- Run `npm test`, including the pretest source-link guard. Tests use synthetic fixtures, not real user data or backup repositories.
- Preserve source and runtime fingerprint checks and current-build backup/isolated-restore gates for automatic tasks. Neither a version string nor an old successful snapshot authorizes a changed build.
- Proot readability and matching bytes do not establish native Android type, inode/link count, owner, mode or SELinux preservation. Native before/after checks and controlled real restore acceptance are separate requirements.
- Do not publish runtime records, private configuration, keys, credentials, backups or incident evidence. Root repairs are explicit manual operations and must never become automatic background healing.
