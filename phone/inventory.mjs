// Read-only metadata inventory. No credential values, chat text or memory bodies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Absolute output directory required');
const home = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
if (output === home || output.startsWith(home + path.sep)) throw new Error('Output must be outside DSH_HOME');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
const errors = [];
const report = {
  schema: 1, collectedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, uid: process.getuid?.(),
    home: os.homedir(), dshHome: home, dshHomeReal: real(home), cwd: process.cwd() },
  processes: [], profiles: [], roots: [], symlinks: [], sqlite: [], errors,
  assurance: 'Metadata only; neither a backup nor a cross-plugin point-in-time snapshot.'
};
function problem(op, p, e) { errors.push({ op, path: p, code: e?.code || 'UNAVAILABLE' }); }
for (const id of fs.readdirSync('/proc').filter(s => /^\d+$/.test(s))) {
  try {
    const args = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0');
    if (!args.some(s => /(?:^|\/)dsh(?:\.js)?$|dsh-host|\/dsh\/lib\//.test(s))) continue;
    const env = Object.fromEntries(fs.readFileSync(`/proc/${id}/environ`, 'utf8').split('\0')
      .map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)])
      .filter(([k]) => ['HOME', 'DSH_HOME', 'DSH_PROFILE', 'PWD'].includes(k)));
    report.processes.push({ pid: Number(id), executable: real(`/proc/${id}/exe`), cwd: real(`/proc/${id}/cwd`), env });
  } catch {}
}
let profiles = [];
try { profiles = fs.readdirSync(path.join(home, 'profiles')); } catch (e) { problem('profiles', home, e); }
const roots = new Map([[home, 'DSH_HOME']]);
for (const profile of profiles) {
  const dir = path.join(home, 'profiles', profile);
  if (!fs.statSync(dir).isDirectory()) continue;
  const entry = { profile, directory: dir, packages: [], configRoots: [], configParsed: false };
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    entry.bundles = manifest.dsh?.profile?.bundles;
    for (const name of Object.keys(manifest.dependencies || {})) {
      if (!/heart|mnemon|@deepseek-ai\/dsh$/.test(name)) continue;
      const location = path.join(dir, 'node_modules', name);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
        entry.packages.push({ name, version: pkg.version, installed: location, real: real(location) });
      } catch (e) { problem('package', location, e); }
    }
    const req = createRequire(path.join(dir, 'package.json'));
    let yaml;
    for (const base of [null, '@deepseek-ai/dsh', 'dsh-mnemon']) {
      try { yaml = base ? createRequire(req.resolve(base)).call(null, 'yaml') : req('yaml'); break; } catch {}
    }
    if (yaml) {
      const patch = yaml.parse(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'),
        { logLevel: 'silent', customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: () => null }] });
      const walk = items => { for (const item of Array.isArray(items) ? items : []) {
        if (typeof item?.id === 'string') {
          const cfg = item.config || {};
          const selected = {};
          for (const key of ['root', 'dataDir', 'workspace', 'workspaceDir', 'storageScope', 'cliPath', 'writeEnabled']) {
            if (['string','boolean'].includes(typeof cfg[key])) selected[key] = cfg[key];
          }
          if (Object.keys(selected).length) entry.configRoots.push({ id: item.id, disabled: item.disabled === true, config: selected });
          for (const key of ['root', 'dataDir', 'workspace', 'workspaceDir']) {
            if (typeof cfg[key] === 'string' && path.isAbsolute(cfg[key]) && item.disabled !== true)
              roots.set(cfg[key], `profile:${profile}/${item.id}/${key}`);
          }
        }
        if (item?.insert) walk(item.insert);
      } };
      walk(patch); entry.configParsed = true;
    }
  } catch (e) { problem('profile-config', dir, e); }
  report.profiles.push(entry);
}
// Do not infer that excluded folders are safe to discard. They are explicitly uncovered.
const skip = new Set(['node_modules', '.cache', '.git', '.venv', '.venv310', 'backups']);
const visited = new Set();
let scanned = 0;
function walk(p, info) {
  if (++scanned > 200000) throw Object.assign(new Error(), { code: 'INVENTORY_LIMIT' });
  let s;
  try { s = fs.lstatSync(p); } catch (e) { problem('lstat', p, e); return; }
  if (s.isSymbolicLink()) {
    report.symlinks.push({ path: p, target: fs.readlinkSync(p), real: real(p), followed: false }); return;
  }
  if (s.isDirectory()) {
    if (skip.has(path.basename(p))) { info.notScanned.push(p); return; }
    try { for (const child of fs.readdirSync(p)) walk(path.join(p, child), info); }
    catch (e) { problem('directory', p, e); }
    return;
  }
  if (!s.isFile()) return;
  info.files++; info.bytes += s.size;
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const header = Buffer.alloc(16); fs.readSync(fd, header, 0, 16, 0);
    if (header.toString() === 'SQLite format 3\0') {
      // No database open is performed here: enumeration must not create WAL/SHM.
      report.sqlite.push({ path: p, size: s.size, walPresent: fs.existsSync(p+'-wal'), shmPresent: fs.existsSync(p+'-shm'), integrityChecked: false });
    }
  } catch (e) { problem('header', p, e); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
for (const [source, discoveredBy] of roots) {
  const actual = real(source);
  const info = { source, actual, discoveredBy, readable: false, files: 0, bytes: 0, notScanned: [] };
  if (actual && !visited.has(actual)) {
    visited.add(actual);
    try { fs.accessSync(actual, fs.constants.R_OK); info.readable = true; walk(actual, info); }
    catch (e) { problem('root', source, e); }
  } else if (actual) info.duplicateOf = actual;
  report.roots.push(info);
}
// Probe only runtime API availability; do not open any production database.
try { report.sqliteBackupApi = typeof (await import('node:sqlite')).backup === 'function'; }
catch { report.sqliteBackupApi = false; }
const file = path.join(output, 'inventory.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(output, 'inventory.sha256'), `${digest}  inventory.json\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, file, roots: report.roots.length, sqlite: report.sqlite.length, errors: errors.length }));
