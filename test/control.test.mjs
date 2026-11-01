import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {projectVaultStatus, readVaultStatus} from '../lib/status.mjs';
import {save} from '../pc/control/context.mjs';
import {localPhoneBuild} from '../lib/build-identity.mjs';

const deviceId = 'xiaoman-control-fixture';
const record = {snapshotId: 'a'.repeat(64), verifiedAt: '2026-11-01T00:00:00Z', files: 3, bytes: 12};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-control-test-'));
  t.after(() => { const absolute = path.resolve(root); if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('vault-control-test-')) throw Error('invalid cleanup'); fs.rmSync(absolute, {recursive: true, force: true}); });
  fs.writeFileSync(path.join(root, '.xiaoman-vault'), JSON.stringify({schema: 1, deviceId}));
  return root;
}
test('public status is allowlisted and refers only to verified records', () => {
  const status = {deviceId, lastResult: 'verified', lastSuccess: record.verifiedAt, lastVerifiedSnapshot: record.snapshotId, privateKey: 'NEVER-EXPORT', contents: {memory: 'NEVER-EXPORT'}, dataRoot: 'NEVER-EXPORT'};
  const projected = projectVaultStatus(status, {snapshots: [record]}, deviceId);
  assert.equal(projected.lastVerified.snapshotId, record.snapshotId); assert.equal(projected.verificationPointerMatched, true);
  assert.ok(!JSON.stringify(projected).includes('NEVER-EXPORT'));
  assert.equal(projectVaultStatus({...status, lastVerifiedSnapshot: 'b'.repeat(64)}, {snapshots: []}, deviceId).lastVerified, null);
  assert.throws(() => projectVaultStatus({...status, deviceId: 'different-device'}, {snapshots: [record]}, deviceId), /IDENTITY/);
});
test('status-summary CLI does not decrypt credentials, create mutex or modify status even on failure', t => {
  const root = fixture(t); const configFile = path.join(root, 'configuration.json');
  fs.writeFileSync(configFile, JSON.stringify({dataRoot: root, deviceId}));
  const stateFile = path.join(root, 'status.json'); fs.writeFileSync(stateFile, JSON.stringify({deviceId, lastResult: 'verified', lastVerifiedSnapshot: record.snapshotId, lastSuccess: record.verifiedAt}));
  fs.writeFileSync(path.join(root, 'verified.json'), JSON.stringify({schema: 1, snapshots: [record]}));
  fs.writeFileSync(path.join(root, 'secrets.dpapi'), 'not decryptable; must not read it');
  const before = fs.readFileSync(stateFile);
  const run = () => spawnSync(process.execPath, ['pc/vault.mjs', 'status-summary', configFile], {encoding: 'utf8', windowsHide: true});
  const ok = run(); assert.equal(ok.status, 0, ok.stdout); assert.equal(JSON.parse(ok.stdout).lastVerified.snapshotId, record.snapshotId);
  assert.deepEqual(fs.readFileSync(stateFile), before); assert.equal(fs.existsSync(path.join(root, 'coordinator.sqlite')), false); assert.equal(fs.existsSync(path.join(root, 'scratch')), false);
  fs.writeFileSync(path.join(root, 'verified.json'), 'broken'); const failed = run(); assert.equal(failed.status, 1);
  assert.deepEqual(fs.readFileSync(stateFile), before);
});
test('control modules import without starting a process; atomic status writes leave no temporary files', async t => {
  const root = fixture(t); save(path.join(root, 'sample.json'), {state: 'one'}); save(path.join(root, 'sample.json'), {state: 'two'});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'sample.json'))).state, 'two'); assert.ok(!fs.readdirSync(root).some(name => name.endsWith('.tmp')));
  await import('../pc/control/commands.mjs'); await import('../pc/control/discovery.mjs');
  assert.equal(localPhoneBuild().sourceDigest, '30583cfd9e4d64e2cfda0bc1b7123baf69e3487cea405fdc75cb63653f984f1b');
});
