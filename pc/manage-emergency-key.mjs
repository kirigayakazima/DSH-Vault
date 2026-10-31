import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { protect, scratch, removeScratch } from '../lib/windows-private.mjs';
import { run } from '../lib/restic.mjs';

function ask(prompt, masked = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (masked && process.stdin.isTTY) {
      process.stdout.write(prompt);
      let pw = '';
      const onData = (chunk) => {
        const str = chunk.toString('utf8');
        for (const char of str) {
          if (char === '\r' || char === '\n' || char === '\u0004') {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            rl.close();
            return resolve(pw);
          } else if (char === '\u0003') {
            process.exit(1);
          } else if (char === '\u007f' || char === '\b') {
            if (pw.length > 0) {
              pw = pw.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else {
            pw += char;
            process.stdout.write('*');
          }
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(prompt, (ans) => {
        rl.close();
        resolve(ans);
      });
    }
  });
}

function loadConfigAndSecrets(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const root = cfg.dataRoot;
  const rawDpapi = fs.readFileSync(path.join(root, 'secrets.dpapi'), 'utf8');
  const secrets = JSON.parse(protect(rawDpapi, 'unprotect'));
  return { cfg, root, secrets };
}

async function listKeys(cfg, root, secrets) {
  const work = scratch(root);
  try {
    const pwFile = path.join(work, 'repo.pw');
    fs.writeFileSync(pwFile, secrets.repositoryPassword, { mode: 0o600 });
    const repo = path.join(root, 'repositories/xiaoman');
    const cacheDir = path.join(root, 'cache');
    const res = await run(cfg.restic, ['key', 'list', '--json', '-r', repo, '-p', pwFile, '--cache-dir', cacheDir]);
    return JSON.parse(res.stdout);
  } finally {
    removeScratch(root, work);
  }
}

async function addCustomKey(cfg, root, secrets, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('密码长度不能少于 8 个字符。');
  }
  const work = scratch(root);
  try {
    const oldPwFile = path.join(work, 'old.pw');
    const newPwFile = path.join(work, 'new.pw');
    fs.writeFileSync(oldPwFile, secrets.repositoryPassword, { mode: 0o600 });
    fs.writeFileSync(newPwFile, newPassword, { mode: 0o600 });

    const repo = path.join(root, 'repositories/xiaoman');
    const cacheDir = path.join(root, 'cache');

    // 1. 添加新 key
    await run(cfg.restic, [
      'key', 'add',
      '--new-password-file', newPwFile,
      '-r', repo,
      '-p', oldPwFile,
      '--cache-dir', cacheDir
    ]);

    // 2. 立即使用新密码验证能否解锁与读取快照
    const verifyRes = await run(cfg.restic, [
      'snapshots', '--json',
      '-r', repo,
      '-p', newPwFile,
      '--cache-dir', cacheDir
    ]);

    const snapshots = JSON.parse(verifyRes.stdout);
    return {
      success: true,
      verifiedSnapshotsCount: snapshots.length,
      latestSnapshotId: snapshots.at(-1)?.id
    };
  } finally {
    removeScratch(root, work);
  }
}

function generateKitText(cfg, root, secrets) {
  const repoPath = path.resolve(root, 'repositories/xiaoman');
  return `================================================================================
          小满保险箱（Xiaoman Vault）终极灾难恢复手册 (Emergency Kit)
================================================================================
生成时间: ${new Date().toISOString()}
设备 ID:  ${cfg.deviceId}

【警告】此文件包含小满保险箱的离线解密主凭据。
请将此手册存放在安全的离线存储介质（如加密 U 盘、打印在纸上、或私人密码管理器中）。
切勿将此文件上传到任何公共网络、公共网盘或 GitHub。

--------------------------------------------------------------------------------
一、 备份仓库位置
--------------------------------------------------------------------------------
本地密文仓库路径:
${repoPath}

--------------------------------------------------------------------------------
二、 系统自动主密码 (Master Repository Password)
--------------------------------------------------------------------------------
${secrets.repositoryPassword}

--------------------------------------------------------------------------------
三、 任何电脑上的通用独立解密与恢复步骤（无需任何本工程代码）
--------------------------------------------------------------------------------
1. 在任何电脑（Windows / macOS / Linux）上下载官方 restic 工具：
   https://github.com/restic/restic/releases

2. 打开终端，将备份仓库目录（repositories/xiaoman）拷贝到新电脑上；

3. 查看所有历史快照：
   restic -r "<备份仓库路径>" snapshots
   （提示输入密码时，输入上方的主密码，或您添加的自定义灾备密码）

4. 恢复最新快照到指定目录：
   restic -r "<备份仓库路径>" restore latest --target "<目标解密还原目录>"

恢复完成后，小满的完整脑部数据（Heart 记忆、Notebook、SQLite 数据库、
2 万余条会话记录）将完整呈现在目标目录中。
================================================================================
`;
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args[0] || 'config.local.json';
  const action = args[1] || 'help';

  if (!fs.existsSync(configPath)) {
    console.error(`错误: 找不到配置文件: ${configPath}`);
    process.exit(1);
  }

  const { cfg, root, secrets } = loadConfigAndSecrets(configPath);

  if (action === 'list') {
    console.log('正在查询当前仓库已注册的所有密钥...');
    const keys = await listKeys(cfg, root, secrets);
    console.log('当前仓库注册密钥清单:');
    console.table(keys.map(k => ({
      ID: k.id.slice(0, 16) + '...',
      '创建时间': k.created,
      '创建用户': k.userName,
      '创建主机': k.hostName,
      '当前系统使用': k.current ? '是 (主密钥)' : '否'
    })));
  } else if (action === 'add') {
    console.log('=== 为小满保险箱添加自定义独立灾备密码 ===');
    console.log('说明:');
    console.log('1. 新增密码不会影响现有系统定时任务与自动热备；');
    console.log('2. 之后哪怕当前 PC 报废或重装系统，只要输入此密码，即可在任何电脑上用 restic 还原小满；');
    console.log('3. 密码长度至少 8 位，且务必妥善记牢。\n');

    let pw = process.env.NEW_KEY_PASSWORD;
    if (!pw) {
      pw = await ask('请输入您想设置的自定义灾备密码: ', true);
      const confirm = await ask('请再次输入以确认: ', true);
      if (pw !== confirm) {
        console.error('两次输入的密码不一致，操作已取消。');
        process.exit(1);
      }
    }

    console.log('正在向加密仓库写入新密钥并进行解密闭环检验...');
    const res = await addCustomKey(cfg, root, secrets, pw);
    console.log('\n[成功] 新灾备密码已成功绑定并完成解密验证！');
    console.log(`- 验证可解锁快照数: ${res.verifiedSnapshotsCount}`);
    console.log(`- 最新快照 ID: ${res.latestSnapshotId}`);
    console.log('\n提示: 您之后可以用此密码在任何机器上使用官方 restic 命令解锁该仓库。');
  } else if (action === 'export-kit') {
    const outPath = args[2] || path.join(root, 'xiaoman-emergency-kit.txt');
    const text = generateKitText(cfg, root, secrets);
    fs.writeFileSync(outPath, text, { encoding: 'utf8', mode: 0o600 });
    console.log(`[成功] 独立灾难恢复手册已导出至: ${outPath}`);
    console.log('请尽快将其备份至您的离线 U 盘或私人密码管理器，并从公共目录移除。');
  } else if (action === 'show-system-key') {
    console.log(generateKitText(cfg, root, secrets));
  } else {
    console.log(`
小满保险箱（Xiaoman Vault）密钥与灾备管理工具

用法:
  node pc/manage-emergency-key.mjs [configPath] <action> [options]

常用指令:
  list              列出仓库当前拥有的所有解密密钥
  add               交互式为仓库添加一把您自己的“脑力密码”（第二灾备密码）
  export-kit [file] 导出离线完整灾难恢复手册文本文件（可存入 U 盘）
  show-system-key   在当前终端屏幕上查看自动生成的系统主密码与官方恢复指引
`);
  }
}

main().catch(err => {
  console.error('[执行失败]:', err.message);
  process.exit(1);
});
