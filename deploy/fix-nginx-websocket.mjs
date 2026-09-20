#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directives = [
  'proxy_http_version 1.1;',
  'proxy_set_header Upgrade $http_upgrade;',
  'proxy_set_header Connection "upgrade";',
  'proxy_set_header Host $http_host;',
  'proxy_set_header X-Forwarded-Host $http_host;',
  'proxy_set_header X-Forwarded-Proto $scheme;',
];
const managedHeaders = new Set(['upgrade', 'connection', 'host', 'x-forwarded-host', 'x-forwarded-proto']);

// Read nginx blocks without mistaking comments, quoted strings or ${variables}
// for block boundaries. Offsets let us preserve unrelated configuration verbatim.
function parseConfig(source) {
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    if (source[offset] === '#') {
      while (offset < source.length && source[offset] !== '\n') offset++;
      continue;
    }
    const start = offset;
    if ('{};'.includes(source[offset])) {
      tokens.push({ value: source[offset++], start, end: offset, punctuation: true });
      continue;
    }
    let value = '';
    let quote;
    while (offset < source.length) {
      const char = source[offset];
      if (char === '\\') {
        value += source.slice(offset, offset + 2);
        offset += 2;
      } else if (quote) {
        offset++;
        if (char === quote) quote = undefined;
        else value += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        offset++;
      } else if (char === '$' && source[offset + 1] === '{') {
        const end = source.indexOf('}', offset + 2);
        if (end < 0) throw new Error('Nicht abgeschlossene Nginx-Variable.');
        value += source.slice(offset, end + 1);
        offset = end + 1;
      } else if (/\s/.test(char) || '{};#'.includes(char)) break;
      else { value += char; offset++; }
    }
    if (quote) throw new Error('Nicht abgeschlossene Zeichenkette in der Nginx-Konfiguration.');
    tokens.push({ value, start, end: offset });
  }
  const root = { children: [] };
  const stack = [root];
  let words = [];
  for (const token of tokens) {
    if (!token.punctuation) { words.push(token); continue; }
    if (token.value === '}') {
      if (words.length || stack.length === 1) throw new Error('Unerwartetes Blockende in der Nginx-Konfiguration.');
      const node = stack.pop();
      node.end = token.end;
      continue;
    }
    if (!words.length) throw new Error('Leere Nginx-Anweisung.');
    const node = { name: words[0].value, args: words.slice(1).map(word => word.value), start: words[0].start, end: token.end };
    stack.at(-1).children.push(node);
    words = [];
    if (token.value === '{') {
      node.children = [];
      stack.push(node);
    }
  }
  if (stack.length !== 1 || words.length) throw new Error('Unvollständige Nginx-Konfiguration.');
  return root;
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

export function patchConfig(source, domain) {
  const root = parseConfig(source);
  const edits = [];
  let proxyBlocks = 0;
  walk(root, server => {
    if (server.name !== 'server' || !server.children?.some(child => child.name === 'server_name' && child.args.some(name => name.toLowerCase() === domain.toLowerCase()))) return;
    walk(server, block => {
      const proxy = block.children?.find(child => child.name === 'proxy_pass');
      if (!proxy) return;
      if (block.name !== 'location') throw new Error('proxy_pass außerhalb eines einfachen location-Blocks: bitte manuell prüfen.');
      proxyBlocks++;
      const relevant = block.children.filter(child => child.name === 'proxy_http_version' ||
        (child.name === 'proxy_set_header' && managedHeaders.has(child.args[0]?.toLowerCase())));
      const current = relevant.map(child => source.slice(child.start, child.end));
      if (directives.every(directive => current.includes(directive)) && current.length === directives.length) return;

      for (const child of relevant) {
        const lineStart = source.lastIndexOf('\n', child.start - 1) + 1;
        const lineEnd = source.indexOf('\n', child.end);
        const end = lineEnd < 0 ? source.length : lineEnd;
        const wholeLine = /^[ \t]*$/.test(source.slice(lineStart, child.start)) && /^[ \t]*$/.test(source.slice(child.end, end));
        edits.push({ start: wholeLine ? lineStart : child.start, end: wholeLine && lineEnd >= 0 ? end + 1 : child.end, text: '' });
      }
      const lineStart = source.lastIndexOf('\n', proxy.start - 1) + 1;
      const indent = source.slice(lineStart, proxy.start).match(/^[ \t]*/)[0] || '        ';
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      edits.push({ start: proxy.end, end: proxy.end, text: newline + directives.map(directive => indent + directive).join(newline) });
    });
  });
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { source: result, proxyBlocks };
}

export function planChanges(dump, domain) {
  // nginx -T lists only files included in its active configuration. Follow
  // sites-enabled symlinks, but keep those symlinks intact when writing.
  const paths = [...dump.matchAll(/^# configuration file (.+):\r?$/gm)].map(match => realpathSync(match[1]));
  const changes = [];
  let proxyBlocks = 0;
  for (const path of new Set(paths)) {
    const original = readFileSync(path, 'utf8');
    // Included location fragments cannot be attributed to one virtual host
    // safely. Only modify files containing the matching server block itself.
    if (!original.toLowerCase().includes(domain.toLowerCase())) continue;
    const patched = patchConfig(original, domain);
    proxyBlocks += patched.proxyBlocks;
    if (patched.source !== original) changes.push({ path, original, updated: patched.source });
  }
  if (!proxyBlocks) throw new Error(`Kein direkter Proxy-Block für ${domain} gefunden. Es wurde nichts verändert. Bitte die aktive Nginx-Konfiguration prüfen.`);
  return changes;
}

export function applyChanges(changes, run, log = console.log, backupDirectory = '/var/backups/scool-tools-nginx') {
  if (!changes.length) { log('Die WebSocket-Weiterleitung ist bereits eingerichtet.'); return; }
  // Check the complete plan before writing any file.
  for (const change of changes) {
    if (readFileSync(change.path, 'utf8') !== change.original) throw new Error(`Konfiguration wurde zwischenzeitlich geändert: ${change.path}`);
  }
  // Keep backups outside nginx include directories, especially sites-enabled/*.
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const written = [];
  let reloading = false;
  try {
    for (const change of changes) {
      const backup = join(backupDirectory, `${basename(change.path)}-${randomUUID()}.bak`);
      copyFileSync(change.path, backup, constants.COPYFILE_EXCL);
      written.push({ ...change, backup });
      log(`Sicherung: ${backup}`);
      writeFileSync(change.path, change.updated, { mode: statSync(change.path).mode });
    }
    run('nginx', ['-t']);
    reloading = true;
    run('systemctl', ['reload', 'nginx']);
  } catch (error) {
    const rollbackErrors = [];
    for (const change of written) {
      try { copyFileSync(change.backup, change.path); }
      catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (reloading && !rollbackErrors.length) {
      try { run('nginx', ['-t']); run('systemctl', ['reload', 'nginx']); }
      catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    throw new Error(`${error.message}\n${rollbackErrors.length ? 'Wiederherstellung bitte prüfen: ' + rollbackErrors.join('; ') : 'Die vorherigen Konfigurationsdateien wurden wiederhergestellt.'}`);
  }
  log('Nginx wurde geprüft und neu geladen. Bitte die Website im Browser neu laden.');
}

function main(args) {
  const check = args.includes('--check');
  const positional = args.filter(arg => arg !== '--check');
  const domain = positional[0] || 'tools.gesu.de';
  if (positional.length > 1 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)) throw new Error('Aufruf: node deploy/fix-nginx-websocket.mjs [tools.gesu.de] [--check]');
  if (!check && process.getuid?.() !== 0) throw new Error('Bitte auf dem Ubuntu-Server als root ausführen.');
  const run = (command, arguments_) => execFileSync(command, arguments_, { stdio: 'inherit' });
  run('nginx', ['-t']);
  const dump = execFileSync('nginx', ['-T'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  const changes = planChanges(dump, domain);
  if (check) {
    console.log(changes.length ? `Würde folgende Dateien sichern und anpassen:\n${changes.map(change => change.path).join('\n')}` : 'Die WebSocket-Weiterleitung ist bereits eingerichtet.');
    return;
  }
  applyChanges(changes, run);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`WebSocket-Einrichtung fehlgeschlagen: ${error.message}`); process.exitCode = 1; }
}
