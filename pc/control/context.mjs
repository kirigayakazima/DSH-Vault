// Private PC repository context. Never handed to an Agent or HTTP viewer.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Restic} from '../../lib/restic.mjs';
import {protect} from '../../lib/windows-private.mjs';

export function save(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function createContext(cfg, {print, scheduled = false} = {}) {
  const root = path.resolve(cfg.dataRoot);
  const secret = () => JSON.parse(protect(fs.readFileSync(path.join(root, 'secrets.dpapi'), 'utf8'), 'unprotect'));
  const admin = (configuration, value, work) => {
    const passwordFile = path.join(work, 'repository.password');
    fs.writeFileSync(passwordFile, value.repositoryPassword, {mode: 0o600});
    return new Restic({executable: configuration.restic, repository: path.join(root, 'repositories/xiaoman'), passwordFile, cacheDir: path.join(root, 'cache')});
  };
  return {root, secret, admin, save, print, scheduled};
}
