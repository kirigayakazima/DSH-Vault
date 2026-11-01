import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('bootstrap requires an independently supplied valid device ID before reading installation files', () => {
  for (const args of [[], ['--device-id'], ['--device-id', '../outside'], ['--device-id', 'short']]) {
    const result = spawnSync(process.execPath, ['phone/install-paired.mjs', ...args], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXPECTED_DEVICE_ID_REQUIRED/);
    assert.doesNotMatch(result.stderr, /ENOENT|ALREADY_INSTALLED/);
    assert.equal(result.stdout, '');
  }
});
