// Public, read-only status projection. No DPAPI, restic, network, locks or writes.
import fs from 'node:fs';
import path from 'node:path';

const error = code => Object.assign(new Error(code), {code});
const snapshotId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function projectVaultStatus(status, verified, deviceId, now = new Date()) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(deviceId || '')) throw error('VAULT_IDENTITY_MISMATCH');
  if (!status || typeof status !== 'object' || !verified || !Array.isArray(verified.snapshots)) throw error('VAULT_STATUS_INVALID');
  if (status.deviceId !== undefined && status.deviceId !== deviceId) throw error('VAULT_IDENTITY_MISMATCH');
  const candidates = verified.snapshots.filter(item => item && snapshotId(item.snapshotId) && iso(item.verifiedAt));
  // The explicit last-success pointer is authoritative; otherwise show a known verified record.
  const selected = candidates.findLast(item => item.snapshotId === status.lastVerifiedSnapshot)
    ?? [...candidates].sort((a, b) => Date.parse(a.verifiedAt) - Date.parse(b.verifiedAt)).at(-1);
  const result = new Set(['verified', 'phone-offline', 'failed', 'not-due']).has(status.lastResult) ? status.lastResult : 'unknown';
  return {
    schema: 1, kind: 'vault-status', deviceId, observedAt: now.toISOString(),
    phoneOnline: typeof status.phoneOnline === 'boolean' ? status.phoneOnline : null,
    lastAttempt: iso(status.lastAttempt), lastResult: result,
    errorCode: typeof status.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(status.errorCode) ? status.errorCode : null,
    lastVerified: selected ? {snapshotId: selected.snapshotId, verifiedAt: iso(selected.verifiedAt), files: count(selected.files), bytes: count(selected.bytes)} : null,
    verificationPointerMatched: Boolean(selected && selected.snapshotId === status.lastVerifiedSnapshot && iso(status.lastSuccess) === iso(selected.verifiedAt)),
  };
}

export function readVaultStatus(root, deviceId) {
  const marker = JSON.parse(fs.readFileSync(path.join(root, '.xiaoman-vault'), 'utf8'));
  if (marker.schema !== 1 || marker.deviceId !== deviceId) throw error('VAULT_IDENTITY_MISMATCH');
  const read = name => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw error('VAULT_STATUS_INVALID');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  return projectVaultStatus(read('status.json'), read('verified.json'), deviceId);
}
