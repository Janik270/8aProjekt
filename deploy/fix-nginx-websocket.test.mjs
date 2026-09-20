import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchConfig, planChanges, applyChanges } from './fix-nginx-websocket.mjs';

const config = `# ignored: server { server_name tools.gesu.de; }
server {
    listen 80;
    server_name tools.gesu.de;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name tools.gesu.de alias.example;
    ssl_certificate /existing/fullchain.pem;
    ssl_certificate_key /existing/privkey.pem;
    location / {
        auth_basic "Access {restricted}";
        proxy_http_version 1.0;
        proxy_set_header Connection close;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://127.0.0.1:3001;
    }
    location /api/ {
        limit_req zone=api burst=120 nodelay;
        proxy_pass http://127.0.0.1:3001;
    }
}
server {
    server_name another.example;
    location / { proxy_pass http://127.0.0.1:9000; }
}
`;

test('patches only the requested domain and preserves TLS, auth, limits and upstreams', () => {
  const patched = patchConfig(config, 'tools.gesu.de');
  assert.equal(patched.proxyBlocks, 2);
  assert.equal(patched.source.split('proxy_set_header Upgrade $http_upgrade;').length - 1, 2);
  for (const line of [
    'ssl_certificate /existing/fullchain.pem;', 'ssl_certificate_key /existing/privkey.pem;',
    'auth_basic "Access {restricted}";', 'limit_req zone=api burst=120 nodelay;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    'location / { proxy_pass http://127.0.0.1:9000; }', 'return 301 https://$host$request_uri;',
  ]) assert.ok(patched.source.includes(line), line);
  assert.ok(!patched.source.includes('proxy_http_version 1.0;'));
  assert.ok(!patched.source.includes('proxy_set_header Connection close;'));
  assert.equal(patchConfig(patched.source, 'tools.gesu.de').source, patched.source);
});

test('handles single-line blocks, comments, quoted regexes and nginx variables', () => {
  const source = 'server { server_name tools.gesu.de; location ~ "^/api/[a-z]{2}/" { proxy_pass http://${backend}; proxy_set_header Connection close; # }\n } }';
  const patched = patchConfig(source, 'tools.gesu.de').source;
  assert.ok(patched.includes('proxy_pass http://${backend};'));
  assert.ok(patched.includes('proxy_set_header Connection "upgrade";'));
  assert.equal(patchConfig(patched, 'tools.gesu.de').source, patched);
  assert.throws(() => patchConfig('server {', 'tools.gesu.de'), /Unvollständig/);
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'scool-nginx-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'site.conf');
  writeFileSync(path, config);
  return { directory, path, backupDirectory: join(directory, 'backups'), changes: [{ path, original: config, updated: patchConfig(config, 'tools.gesu.de').source }] };
}

test('discovers active files, deduplicates symlinks and refuses an unknown domain', t => {
  const { directory, path, backupDirectory } = fixture(t);
  const enabled = join(directory, 'enabled');
  symlinkSync(path, enabled);
  const dump = `# configuration file ${enabled}:\n${config}\n# configuration file ${path}:\n${config}`;
  const plan = planChanges(dump, 'tools.gesu.de');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].path, path);
  applyChanges(plan, () => {}, () => {}, backupDirectory);
  assert.ok(lstatSync(enabled).isSymbolicLink());
  assert.equal(readFileSync(enabled, 'utf8'), plan[0].updated);
  assert.throws(() => planChanges(dump, 'unknown.example'), /Kein direkter Proxy-Block/);
});

test('backs up before writing and validates before reload', t => {
  const { path, changes, backupDirectory } = fixture(t);
  const commands = [];
  applyChanges(changes, (command, args) => {
    commands.push([command, ...args]);
    assert.equal(readFileSync(path, 'utf8'), changes[0].updated);
    const [backup] = readdirSync(backupDirectory);
    assert.equal(readFileSync(join(backupDirectory, backup), 'utf8'), config);
  }, () => {}, backupDirectory);
  assert.deepEqual(commands, [['nginx', '-t'], ['systemctl', 'reload', 'nginx']]);
});

test('failed nginx validation restores the original without reloading', t => {
  const { path, changes, backupDirectory } = fixture(t);
  const commands = [];
  assert.throws(() => applyChanges(changes, (command, args) => {
    commands.push([command, ...args]);
    throw new Error('duplicate directive');
  }, () => {}, backupDirectory), /wiederhergestellt/);
  assert.equal(readFileSync(path, 'utf8'), config);
  assert.deepEqual(commands, [['nginx', '-t']]);
});

test('failed reload restores and reloads the previous configuration', t => {
  const { path, changes, backupDirectory } = fixture(t);
  let calls = 0;
  assert.throws(() => applyChanges(changes, () => {
    calls++;
    if (calls === 2) throw new Error('reload failed');
    if (calls > 2) assert.equal(readFileSync(path, 'utf8'), config);
  }, () => {}, backupDirectory), /wiederhergestellt/);
  assert.equal(calls, 4);
});

test('refuses to overwrite a configuration changed after planning', t => {
  const { path, changes, backupDirectory } = fixture(t);
  writeFileSync(path, config + '# an administrator changed this\n');
  assert.throws(() => applyChanges(changes, () => assert.fail('must not run'), () => {}, backupDirectory), /zwischenzeitlich geändert/);
  assert.match(readFileSync(path, 'utf8'), /administrator changed this/);
});
