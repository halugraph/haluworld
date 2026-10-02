#!/usr/bin/env node
// halugraph-mcp — the MCP server of this halugraph project, for Claude Code and Codex (halugraph spec §6.5).
// Shipped by halugraph; do not modify. Reference: tools/doc/halugraph-mcp.md.
//
// The agent CLI starts it as `node tools/cmd/halugraph-mcp.mjs` (.mcp.json, .codex/config.toml). It is a relay:
// it connects to the halugraph server of THIS project — `GET /mcp` with `Upgrade: halugraph-mcp`, first on the
// agent socket (a unix socket; on Windows a named pipe), else over TCP to this machine — and copies MCP's stdio
// framing (one JSON-RPC message per line) both ways, byte for byte. It never interprets the protocol. It only
//   * drops a line from halugraph that is not JSON (one stray byte on stdout would break the client's framing);
//   * answers the handshake itself while halugraph is not running (empty lists; -32601 for unknown methods) and
//     looks for halugraph in the background (250 ms … 5 s; a halugraph that drops each connection at once keeps
//     the backoff growing). Once it is there, it replays initialize, initialized,
//     the log level and the resource subscriptions with private ids, swallows their answers and sends the three
//     list_changed notifications, so the client lists the tools again;
//   * fails the requests in flight when the connection drops (-32000);
//   * exits on end of stdin, SIGINT, SIGTERM (also SIGHUP, Windows Ctrl+Break) or a closed stdout — and, checked
//     every 2 s, when the agent CLI that started it is gone although stdin never ended (another process still
//     holds the pipe).
// It never piles anything up (LIMITS): it stops reading halugraph while stdout is full and stdin while halugraph
// is; it exits when stdout takes nothing for 2 minutes, unsent output passes 64 MB or it uses 1 GiB; it drops a
// connection that sends a line over 64 MB or takes nothing for 2 minutes; a client line over 16 MB gets -32600.
// It never blocks its event loop: the one file it reads is read with a fixed size.
// It finds its project from its own location (tools/cmd/../.. holds .hlg), trusts util/instance.json only when it
// names this project, and uses TCP only to an address of this machine — the rules of tools/cmd/halugraph-client.
// stdout carries JSON-RPC only; log lines go to stderr (HALUGRAPH_MCP_DEBUG=1: one per message). Node >= 18, no
// dependencies.
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Wire constants: the values of src/shared/api.ts in halugraph (a halugraph test checks they are equal).
export const MCP_PATH = '/mcp';
export const MCP_UPGRADE_PROTOCOL = 'halugraph-mcp';
export const MCP_RELAY_HEADER = 'x-halugraph-relay';
export const MCP_ENV_HEADER = 'x-halugraph-mcp-env';
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
/** This relay's generation: the value of the MCP_RELAY_HEADER header. */
export const RELAY_VERSION = '1';
/** The error of a request halugraph cannot answer (in flight when the connection dropped, or sent while it is down). */
export const NOT_RUNNING = 'halugraph is not running for this project — ask the user to start it';
export const CONNECT_TIMEOUT_MS = 5000;
const REPLAY_TIMEOUT_MS = 10000;
const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 5000;
/** A connection that lasted this long was a working session: after it ends, the backoff starts over. */
const STABLE_MS = 5000;
const PRIVATE_ID = 'halugraph-relay:';
const CAPABILITIES = { tools: { listChanged: true }, resources: { subscribe: true, listChanged: true }, prompts: { listChanged: true }, logging: {} };
/** Requests the relay can answer on its own, also when they were in flight on a dropped connection. */
const HANDSHAKE = new Set(['initialize', 'ping', 'logging/setLevel', 'resources/subscribe', 'resources/unsubscribe', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);
const NL = Buffer.from('\n');
const MiB = 1024 * 1024;
/** Subscriptions remembered for the replay: halugraph's own limit per connection. */
const MAX_SUBSCRIPTIONS = 1024;
/** Log lines nobody reads are dropped beyond this (stderr is a pipe too). */
const MAX_LOG_BACKLOG = MiB;

/**
 * The relay's limits. It runs for hours in every project and is never updated there, so nothing in it may grow
 * without bound, whatever the client or halugraph do:
 *  - watchdogMs: how often it checks the agent CLI that started it, its memory, and that stdout and halugraph
 *    take what it writes;
 *  - stallMs: stdout taking nothing for this long (a hung client) → exit; halugraph taking nothing for this long
 *    (a hung halugraph) → the connection is dropped like a crash (and halugraph looked for again);
 *  - maxPendingBytes: unsent output to the client (→ exit) or to halugraph (→ dropped) — halugraph's own limit
 *    for a client that does not read;
 *  - maxLineBytes: one line from halugraph (longer → dropped: its framing is broken);
 *  - maxClientLineBytes: one line from the client (longer → -32600, never forwarded; halugraph takes 11 MB);
 *  - maxQueueBytes: client lines waiting for a connection attempt (beyond it, stdin is not read until they went);
 *  - maxRssBytes: the whole process, a last resort against anything else (→ exit).
 */
export const LIMITS = Object.freeze({
  watchdogMs: 2000,
  stallMs: 120_000,
  maxPendingBytes: 64 * MiB,
  maxLineBytes: 64 * MiB,
  maxClientLineBytes: 16 * MiB,
  maxQueueBytes: 16 * MiB,
  maxRssBytes: 1024 * MiB,
});

/** LIMITS, lowered by HALUGRAPH_MCP_TEST_LIMITS (JSON, for halugraph's own tests): a value can only lower a limit. */
export function relayLimits(env) {
  const limits = { ...LIMITS };
  let asked = null;
  try {
    asked = JSON.parse(env.HALUGRAPH_MCP_TEST_LIMITS || 'null');
  } catch {
    // not JSON: the defaults
  }
  if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return limits;
  for (const key of Object.keys(LIMITS)) {
    const v = asked[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= LIMITS[key] && (key !== 'watchdogMs' || v >= 20)) limits[key] = v;
  }
  return limits;
}

/**
 * True when the process that started the relay (`startPpid`) is gone. POSIX re-parents an orphan (to init or a
 * subreaper), so its parent changed; Windows never re-parents, so that pid no longer runs. Started by init itself
 * (pid ≤ 1): nothing to watch.
 */
export function parentGone(startPpid, { platform = process.platform, ppid = process.ppid, isDead = pidIsDead } = {}) {
  if (!Number.isInteger(startPpid) || startPpid <= 1) return false;
  return platform === 'win32' ? isDead(startPpid) : ppid !== startPpid;
}

const MB = (bytes) => `${Math.round(bytes / MiB)} MB`;

/** The protocol version of the relay's own initialize answer: the client's when halugraph negotiates it, else the newest. */
export function negotiateVersion(requested) {
  return MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
}

/** tools/cmd/../.. when it holds .hlg: first for the path the CLI started (a link stays a link), then for the real file. */
export function findProjectRoot(argv1, moduleFile, isFile = isFileSync) {
  const files = argv1 && path.basename(argv1) === path.basename(moduleFile) ? [path.resolve(argv1), moduleFile] : [moduleFile];
  for (const file of files) {
    const root = path.dirname(path.dirname(path.dirname(file)));
    if (isFile(path.join(root, '.hlg'))) return root;
  }
  return null;
}

function isFileSync(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** One spelling per folder: resolved, and lower-cased on Windows (whose file names ignore letter case). */
export function rootKey(p, platform = process.platform) {
  return platform === 'win32' ? path.win32.resolve(p).toLowerCase() : path.posix.resolve(p);
}

/** True when two spellings name the same folder: equal keys, else equal real paths, else the same file id. */
export function sameRoot(a, b, platform = process.platform) {
  if (rootKey(a, platform) === rootKey(b, platform)) return true;
  try {
    if (rootKey(fs.realpathSync.native(a), platform) === rootKey(fs.realpathSync.native(b), platform)) return true;
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

const bareIp = (address) => {
  let ip = String(address).trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  return zone >= 0 ? ip.slice(0, zone) : ip;
};
const canonicalIp = (ip) => {
  if (!net.isIPv6(ip)) return ip;
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return ip;
  }
};

/** True for an IP address of this machine: loopback, unspecified, IPv4-mapped loopback, a local interface. Names → false. */
export function isLocalIp(address, interfaces = os.networkInterfaces()) {
  const ip = canonicalIp(bareIp(address));
  const family = net.isIP(ip);
  if (family === 0) return false;
  if (family === 4 && (ip.startsWith('127.') || ip === '0.0.0.0')) return true;
  if (family === 6) {
    if (ip === '::1' || ip === '::') return true;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (mapped) {
      const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
      return isLocalIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, interfaces);
    }
  }
  return Object.values(interfaces).some((list) => (list || []).some((i) => canonicalIp(bareIp(i.address)) === ip));
}

/**
 * Where to reach halugraph over TCP, from instance.json (`url`, else `host` + `port`): only an address of this
 * machine, `localhost`, or this machine's own name when it resolves to local addresses. DNS is never asked about
 * any other name. → `{host, port}` or `{error}`.
 */
export async function tcpTarget(instance, deps = {}) {
  const lookup = deps.lookup || ((host, opts) => dns.promises.lookup(host, opts));
  const interfaces = deps.interfaces || os.networkInterfaces();
  const me = String(deps.hostname || os.hostname()).toLowerCase();
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) return { error: 'util/instance.json is not usable' };
  let host = null;
  let port = null;
  try {
    const u = new URL(instance.url);
    if (u.protocol === 'http:' && u.hostname) [host, port] = [u.hostname, u.port ? Number(u.port) : 80];
  } catch {
    // no url: host + port below
  }
  if (host === null && typeof instance.host === 'string' && instance.host && Number.isInteger(instance.port)) [host, port] = [instance.host, instance.port];
  if (host === null || !(port > 0 && port < 65536)) return { error: 'util/instance.json has no usable url' };
  let h = bareIp(host);
  if (h === '0.0.0.0') h = '127.0.0.1';
  else if (net.isIPv6(h) && canonicalIp(h) === '::') h = '::1';
  if (h === 'localhost') return { host: h, port };
  const notHere = { error: `util/instance.json points to ${host}, which is not an address of this machine` };
  if (net.isIP(h)) return isLocalIp(h, interfaces) ? { host: h, port } : notHere;
  if (h !== me && h !== `${me}.local`) return notHere;
  try {
    const found = await lookup(h, { all: true });
    return found.length && found.every((a) => isLocalIp(a.address, interfaces)) ? { host: found[0].address, port } : notHere;
  } catch {
    return notHere;
  }
}

/** A Windows named pipe path (`\\.\pipe\name`, `\\?\pipe\name`, any case, / or \). */
export function isPipePath(p) {
  return typeof p === 'string' && /^[\\/]{2}[.?][\\/]pipe[\\/][^\\/]+/i.test(p);
}

/** Agent sockets to try, in order. POSIX: instance.json's socket, then util/halugraph.sock. Windows: the named pipe only. */
export function socketCandidates(root, instance, platform = process.platform) {
  const sock = instance && typeof instance === 'object' && typeof instance.socket === 'string' ? instance.socket : '';
  if (platform === 'win32') return isPipePath(sock) ? [sock] : [];
  const out = sock && !isPipePath(sock) ? [path.posix.resolve(root, sock)] : [];
  const own = path.posix.join(root, 'util', 'halugraph.sock');
  return out.includes(own) ? out : [...out, own];
}

/** The x-halugraph-mcp-env header: the two variables the server caps wait_for_event with, as JSON in printable ASCII. */
export function envHeader(env) {
  const out = {};
  if (env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS !== undefined) out.autoBackgroundMs = String(env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS).slice(0, 64);
  if (env.HALUGRAPH_MCP_TOOL_TIMEOUT_SEC !== undefined) out.toolTimeoutSec = String(env.HALUGRAPH_MCP_TOOL_TIMEOUT_SEC).slice(0, 64);
  return JSON.stringify(out).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const PEEK_BYTES = 256;
function firstBytes(list, n) {
  const out = [];
  for (let i = 0, have = 0; i < list.length && have < n; i++) {
    const take = list[i].subarray(0, n - have);
    out.push(take);
    have += take.length;
  }
  return Buffer.concat(out);
}
function lastBytes(list, n) {
  const out = [];
  for (let i = list.length - 1, have = 0; i >= 0 && have < n; i--) {
    const take = list[i].subarray(Math.max(0, list[i].length - (n - have)));
    out.unshift(take);
    have += take.length;
  }
  return Buffer.concat(out);
}

/**
 * Calls `onLine` with every complete line (a Buffer without its `\n`) of a byte stream fed in chunks. A line
 * longer than `maxBytes` is never held: it is dropped up to its newline, and `onOversized` hears of it when it
 * goes over (`ended: false`) and when it ends (`ended: true`), with its size and its first and last 256 bytes.
 * `.buffered()`: the bytes held for the unfinished line.
 */
export function lineSplitter(onLine, { maxBytes = Infinity, onOversized = () => {} } = {}) {
  let parts = [];
  let held = 0;
  let over = null; // the line over maxBytes being dropped: { bytes, head, tail }
  const drop = (piece) => {
    if (over) {
      over.bytes += piece.length;
      over.tail = lastBytes([over.tail, piece], PEEK_BYTES);
      return;
    }
    const list = [...parts, piece];
    over = { bytes: held + piece.length, head: firstBytes(list, PEEK_BYTES), tail: lastBytes(list, PEEK_BYTES) };
    [parts, held] = [[], 0];
    onOversized({ ended: false, ...over });
  };
  const split = (chunk) => {
    let start = 0;
    for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, nl);
      start = nl + 1;
      if (over || held + piece.length > maxBytes) {
        drop(piece);
        const info = over;
        over = null;
        onOversized({ ended: true, ...info });
        continue;
      }
      let line = piece;
      if (parts.length) [line, parts, held] = [Buffer.concat([...parts, piece]), [], 0];
      onLine(line);
    }
    if (start >= chunk.length) return;
    const rest = chunk.subarray(start);
    if (over || held + rest.length > maxBytes) return drop(rest);
    parts.push(rest);
    held += rest.length;
  };
  split.buffered = () => held;
  return split;
}

const ID_FIRST = /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"id"\s*:\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*")/;
const ID_LAST = /[,{]\s*"id"\s*:\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*")\s*\}\s*$/;

/**
 * The request id of a line too long to parse, from its first bytes (`{"jsonrpc":"2.0","id":…`, `{"id":…`) or its
 * last (`…,"id":…}` — how the TypeScript SDK writes requests); null when neither shows one.
 */
export function peekRequestId(head, tail) {
  for (const [pattern, bytes] of [[ID_FIRST, head], [ID_LAST, tail]]) {
    const m = pattern.exec(bytes.toString('utf8'));
    if (!m) continue;
    try {
      const id = JSON.parse(m[1]);
      if (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) return id;
    } catch {
      // not a JSON value after all
    }
  }
  return null;
}

/** A line of only spaces, tabs and CR (never forwarded: it is no message). */
export function isBlank(line) {
  for (const b of line) if (b !== 32 && b !== 9 && b !== 13) return false;
  return true;
}

const FAST_RESPONSE = /^\{"jsonrpc":"2\.0","id":(-?(?:0|[1-9]\d{0,14})|"[^"\\\x00-\x1f\x7f-￿]*"),"(?:result|error)":/;
const FAST_NOTIFICATION = /^\{"jsonrpc":"2\.0","method":"/;

/** The last byte of a line that is not a space, tab or CR (-1 for a blank line). */
function lastByte(line) {
  for (let i = line.length - 1; i >= 0; i--) if (line[i] !== 32 && line[i] !== 9 && line[i] !== 13) return line[i];
  return -1;
}

/**
 * The ids of the responses in a line from halugraph: read from the front when the line has the usual form (and
 * ends with `}`), else parsed. null when the line is not JSON: it is dropped, because one stray byte on stdout
 * would break the client's framing (a stray prefix even costs it the next message).
 */
export function responseIds(line) {
  const head = line.subarray(0, 96).toString('latin1');
  const closed = lastByte(line) === 125;
  const fast = closed && FAST_RESPONSE.exec(head);
  if (fast) return [JSON.parse(fast[1])];
  if (closed && FAST_NOTIFICATION.test(head)) return [];
  let msg;
  try {
    msg = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  return each(msg)
    .filter((m) => m && typeof m === 'object' && !Array.isArray(m) && !('method' in m) && 'id' in m && ('result' in m || 'error' in m))
    .map((m) => m.id);
}

function each(msg) {
  return Array.isArray(msg) ? msg : [msg];
}
const isRequest = (m) => !!m && typeof m === 'object' && typeof m.method === 'string' && 'id' in m;

function offlineInstructions(failure) {
  if (failure.refused) return `${failure.message}${failure.reason ? ` (${failure.reason})` : ''}`;
  return [
    'halugraph was not running for this project when this session started, so its tools are not listed yet',
    failure.reason ? ` (${failure.reason}).` : '.',
    ' Ask the user to start it (`halugraph <project folder>`); its tools appear here by themselves as soon as it runs.',
    ' Until then follow AGENTS.md §9 (tools/cmd/halugraph-client ping --wait).',
  ].join('');
}

/**
 * What the relay answers while halugraph is not reachable: the handshake, empty lists and {} for the session
 * requests; -32000 (`failure.message`) for halugraph's own requests; -32601 for anything else. null when no
 * answer is due (notifications, responses, junk); a batch gets a batch.
 */
export function offlineAnswer(msg, failure = { message: NOT_RUNNING }) {
  if (Array.isArray(msg)) {
    const answers = msg.map((m) => offlineAnswer(m, failure)).filter(Boolean);
    return answers.length ? answers : null;
  }
  if (!isRequest(msg)) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: negotiateVersion(params.protocolVersion), capabilities: CAPABILITIES, serverInfo: { name: 'halugraph', version: `relay-${RELAY_VERSION}` }, instructions: offlineInstructions(failure) });
    case 'tools/list':
      return ok({ tools: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    case 'resources/list':
      return ok({ resources: [] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    default:
      if (HANDSHAKE.has(msg.method)) return ok({});
  }
  if (/^(tools|resources|prompts|completion)\//.test(msg.method)) {
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: failure.message, ...(failure.reason ? { data: { reason: failure.reason } } : {}) } };
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
}

/** halugraph writes a few hundred bytes; anything far larger is not its instance.json. */
const MAX_INSTANCE_BYTES = 1 << 20;

/**
 * A regular file of at most `max` bytes → `{text}`, else `{why}` ('not a file' / 'too large'). Opened without
 * blocking (a FIFO), checked on the open handle (the path may have changed since a stat), read into a buffer of
 * the file's size + 1: whatever the file is, the read ends — an endless one (/dev/zero) cannot keep it going.
 */
function readSmallFile(file, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOCTTY || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { why: 'not a file' };
    if (st.size > max) return { why: 'too large' };
    const buf = Buffer.alloc(st.size + 1); // one byte more: a file that grew since the stat is noticed
    let n = 0;
    for (let got = 1; n < buf.length && got > 0; n += got) got = fs.readSync(fd, buf, n, buf.length - n, n);
    return n > st.size ? { why: 'too large' } : { text: buf.toString('utf8', 0, n) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * `util/instance.json` of `root` → `{instance}` or `{why}`. Only a regular file of a sane size is read: a FIFO
 * would block the read and a link to an endless device would never end it — either way with the event loop
 * blocked, so the relay could neither answer nor exit (nor its watchdog run).
 */
export function readInstance(root) {
  const file = path.join(root, 'util', 'instance.json');
  let st;
  try {
    st = fs.statSync(file);
  } catch (err) {
    return { why: err.code === 'ENOENT' ? 'no util/instance.json' : 'util/instance.json is unreadable' };
  }
  if (!st.isFile()) return { why: 'util/instance.json is not a file' };
  if (st.size > MAX_INSTANCE_BYTES) return { why: 'util/instance.json is too large to be halugraph\'s' };
  let v;
  try {
    const read = readSmallFile(file, MAX_INSTANCE_BYTES);
    if (read.why === 'not a file') return { why: 'util/instance.json is not a file' };
    if (read.why) return { why: 'util/instance.json is too large to be halugraph\'s' };
    v = JSON.parse(read.text);
  } catch {
    return { why: 'util/instance.json is unreadable' };
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? { instance: v } : { why: 'util/instance.json is not halugraph\'s' };
}

const pidIsDead = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid >= 2 ** 32) return false;
  try {
    process.kill(pid, 0); // signal 0 only checks (also on Windows, through libuv)
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
};

/** The relay (runs only when started as a program; halugraph's tests import the helpers above). */
function main() {
  const limits = relayLimits(process.env);
  // stderr is a pipe too: lines nobody reads are dropped instead of piling up
  const log = (text) => process.stderr.writableLength <= MAX_LOG_BACKLOG && process.stderr.write(`[halugraph-mcp] ${text}\n`);
  const debug = process.env.HALUGRAPH_MCP_DEBUG ? log : () => {};
  const moduleFile = fileURLToPath(import.meta.url);
  const root = findProjectRoot(process.argv[1], moduleFile);
  const session = { init: null, initialized: null, level: null, subscriptions: new Map() };
  const inflight = new Map(); // JSON of a client request id → { id, method, params } while halugraph owes the answer
  const privateWaits = new Map(); // id of a replayed request → { resolve, reject }
  const queue = [];
  let queuedBytes = 0;
  const stdinHolds = new Set(); // why stdin is not read now: 'halugraph' (does not drain), 'queue' (full), 'stdout' (full)
  const waitingForStdout = new Set(); // what is not read until stdout drained: halugraph connections, stdin
  const dropped = new WeakMap(); // a connection the relay dropped itself → why
  // progress for the watchdog: writes the OS took, to stdout and to halugraph
  let outTaken = 0;
  let sentTaken = 0;
  const outDone = () => void (outTaken += 1);
  const sentDone = () => void (sentTaken += 1);
  let failure = root
    ? { message: NOT_RUNNING, reason: 'halugraph has not been reached yet' }
    : { message: NOT_RUNNING, reason: `this relay is not inside a halugraph project (no .hlg in ${path.dirname(path.dirname(path.dirname(moduleFile)))})` };
  let conn = null;
  let connecting = null;
  let failedAttempts = 0; // connection attempts that failed so far (a message queued before the last one needs no new one)
  let holdUntil = 0; // until then a client message does not start a connection attempt (a hung or flapping halugraph)
  let connectedAt = 0;
  let loggedReason = '';
  let retryTimer = null;
  let retryMs = RETRY_MIN_MS;
  let pumping = false;
  let closing = false;
  let watchdog = null;
  let seq = 0;
  if (!root) log(failure.reason);

  /** One line to the client; false when stdout is full (the caller stops reading its source until it drained). */
  function writeOut(line) {
    if (closing) return true;
    process.stdout.cork();
    process.stdout.write(line);
    const ok = process.stdout.write(NL, outDone);
    process.stdout.uncork();
    const unsent = process.stdout.writableLength;
    if (unsent > limits.maxPendingBytes) stop(`unsent output to the agent CLI is over the limit (${MB(unsent)} > ${MB(limits.maxPendingBytes)}): it does not read`);
    return ok;
  }
  /** Answer the client (true when there was nothing to answer). */
  const answer = (msg) => !msg || writeOut(Buffer.from(JSON.stringify(msg)));

  function holdStdin(why) {
    stdinHolds.add(why);
    process.stdin.pause();
  }
  function releaseStdin(why) {
    if (stdinHolds.delete(why) && !stdinHolds.size && !closing) process.stdin.resume();
  }
  /** stdout is full: stop reading `source` (a halugraph connection, or stdin) until it drained. */
  function holdForStdout(source) {
    if (waitingForStdout.has(source)) return;
    waitingForStdout.add(source);
    if (source === process.stdin) holdStdin('stdout');
    else source.pause();
    if (waitingForStdout.size > 1) return;
    process.stdout.once('drain', () => {
      const held = [...waitingForStdout];
      waitingForStdout.clear();
      for (const s of held) {
        if (s === process.stdin) releaseStdin('stdout');
        else if (!s.destroyed) s.resume();
      }
    });
  }

  /** Reads util/instance.json → the sockets / url to try, and why halugraph may not be reachable. */
  async function discover() {
    let { instance = null, why = null } = readInstance(root);
    if (instance && (typeof instance.root !== 'string' || !instance.root)) [why, instance] = ['util/instance.json has no "root", so halugraph did not write it', null];
    else if (instance && !sameRoot(root, instance.root)) {
      [why, instance] = [`util/instance.json belongs to another project (${instance.root}); this folder was probably copied while halugraph was running`, null];
    }
    const targets = socketCandidates(root, instance)
      .filter((p) => isPipePath(p) || fs.existsSync(p))
      .map((p) => ({ socketPath: p, label: isPipePath(p) ? `the named pipe ${p}` : `the agent socket ${p}` }));
    if (instance && pidIsDead(instance.pid)) why = `util/instance.json is stale: halugraph process ${instance.pid} is gone`;
    else if (instance) {
      const t = await tcpTarget(instance);
      if (t.error) why = t.error;
      else targets.push({ host: t.host, port: t.port, label: `TCP ${t.host}:${t.port}` });
    }
    return { targets, why };
  }

  /** GET /mcp with Upgrade: halugraph-mcp → { socket, head }; rejects with `status` when halugraph answered otherwise. */
  function upgrade(target) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = http.request({
        ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port }),
        method: 'GET',
        path: MCP_PATH,
        agent: false,
        headers: { Connection: 'Upgrade', Upgrade: MCP_UPGRADE_PROTOCOL, [MCP_RELAY_HEADER]: RELAY_VERSION, [MCP_ENV_HEADER]: envHeader(process.env), 'x-halugraph-client': 'agent' },
      });
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(Object.assign(new Error(`halugraph did not answer within ${CONNECT_TIMEOUT_MS / 1000} s (${target.label})`), { slow: true })), CONNECT_TIMEOUT_MS);
      req.on('upgrade', (res, socket, head) => {
        socket.on('error', () => {}); // until open() takes over
        const protocol = String(res.headers.upgrade || '').toLowerCase();
        if (settled || (protocol && protocol !== MCP_UPGRADE_PROTOCOL)) {
          socket.destroy();
          return fail(Object.assign(new Error(`halugraph refused the MCP connection (it switched to "${protocol}")`), { status: 101 }));
        }
        settled = true;
        clearTimeout(timer);
        resolve({ socket, head });
      });
      req.on('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (s) => (body = (body + s).slice(0, 2000)));
        const done = () => {
          let detail = '';
          try {
            detail = String(JSON.parse(body).error || '');
          } catch {
            // not JSON
          }
          fail(Object.assign(new Error(`halugraph refused the MCP connection (HTTP ${res.statusCode})`), { status: res.statusCode, detail }));
        };
        res.on('end', done);
        res.on('error', done);
        res.on('close', done);
      });
      req.on('error', (err) => fail(Object.assign(new Error(`cannot connect to ${target.label} (${err.code || err.message})`), { code: err.code })));
      req.end();
    });
  }

  /** Replays the session on a fresh connection (private ids, answers swallowed), then tells the client to re-list. */
  async function replay(sock) {
    const ask = (msg) =>
      new Promise((resolve, reject) => {
        const id = `${PRIVATE_ID}${++seq}`;
        const timer = setTimeout(() => reject(new Error('halugraph did not answer the replayed handshake')), REPLAY_TIMEOUT_MS);
        const settle = (fn) => (v) => {
          clearTimeout(timer);
          privateWaits.delete(id);
          fn(v);
        };
        privateWaits.set(id, { resolve: settle(resolve), reject: settle(reject) });
        sock.write(`${JSON.stringify({ ...msg, id })}\n`);
      });
    const init = JSON.parse((await ask(session.init)).toString('utf8'));
    if (!init.result) throw new Error(`halugraph refused the replayed initialize (${init.error?.message || 'no result'})`);
    if (session.initialized) sock.write(`${JSON.stringify(session.initialized)}\n`);
    if (session.level) await ask(session.level);
    await Promise.all([...session.subscriptions.values()].map(ask));
    for (const kind of ['tools', 'prompts', 'resources']) answer({ jsonrpc: '2.0', method: `notifications/${kind}/list_changed` });
  }

  /** The relay drops a connection itself (a broken or hung halugraph): why, for the requests in flight. */
  function drop(sock, why) {
    if (sock.destroyed) return;
    log(`${why}; dropping the connection`);
    dropped.set(sock, why);
    sock.destroy();
  }

  function fromServer(line, seen, sock) {
    if (sock.destroyed || isBlank(line)) return; // nothing more from a connection the relay dropped
    const ids = responseIds(line);
    if (ids === null) {
      if (!seen.junk) log(`halugraph sent a line that is not JSON; dropped (${JSON.stringify(line.subarray(0, 60).toString('utf8'))}…)`);
      seen.junk = true;
      return;
    }
    if (ids.length && (inflight.size || privateWaits.size)) {
      const mine = ids.find((id) => typeof id === 'string' && id.startsWith(PRIVATE_ID));
      if (mine !== undefined) return privateWaits.get(mine)?.resolve(line);
      for (const id of ids) inflight.delete(JSON.stringify(id));
    }
    if (!writeOut(line)) holdForStdout(sock);
  }

  function onClose(sock) {
    for (const w of [...privateWaits.values()]) w.reject(new Error('the connection to halugraph closed'));
    if (sock !== conn) return;
    conn = null;
    if (closing) return;
    // A session that lasted is a halugraph that stopped or restarted: look for it again at once. One that
    // ended right away (a halugraph that accepts and drops) keeps the backoff growing, for the background
    // retries and for client calls alike — otherwise every reconnect's list_changed makes the client re-list,
    // which reconnects, and so on, several times a second.
    const now = performance.now();
    const stable = now - connectedAt >= STABLE_MS;
    if (stable) retryMs = RETRY_MIN_MS;
    holdUntil = stable ? 0 : now + retryMs;
    failure = { message: NOT_RUNNING, reason: dropped.get(sock) || 'the connection to halugraph closed (it stopped or restarted)' };
    log(`${failure.reason}; looking for it again in the background`);
    loggedReason = failure.reason;
    for (const req of inflight.values()) {
      answer(HANDSHAKE.has(req.method) ? offlineAnswer({ jsonrpc: '2.0', ...req }, failure) : { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: NOT_RUNNING, data: { reason: failure.reason } } });
    }
    inflight.clear();
    scheduleRetry();
    if (!stable) retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  async function open() {
    const { targets, why } = await discover();
    let reason = why || 'halugraph does not listen on its socket';
    for (const target of targets) {
      let up;
      try {
        up = await upgrade(target);
      } catch (err) {
        if (err.status !== undefined || err.slow) throw err; // halugraph is there, but refused / hangs: no other way helps
        reason = why || err.message;
        continue;
      }
      const sock = up.socket;
      sock.on('error', (err) => debug(`connection error: ${err.message}`));
      if (sock.setNoDelay) sock.setNoDelay(true);
      const seen = { junk: false };
      const split = lineSplitter((line) => fromServer(line, seen, sock), {
        maxBytes: limits.maxLineBytes,
        onOversized: (info) => !info.ended && drop(sock, `halugraph sent a line longer than ${MB(limits.maxLineBytes)}`),
      });
      sock.on('data', split);
      sock.on('close', () => onClose(sock));
      if (up.head && up.head.length) split(up.head);
      try {
        if (session.init) await replay(sock);
      } catch (err) {
        sock.destroy();
        throw err;
      }
      return { sock, label: target.label };
    }
    throw new Error(reason);
  }

  function connect() {
    if (conn) return Promise.resolve(conn);
    if (!connecting) {
      const started = performance.now();
      connecting = open().then(
        ({ sock, label }) => {
          connecting = null;
          if (closing) {
            sock.destroy();
            throw new Error('stopping');
          }
          conn = sock;
          connectedAt = performance.now(); // the backoff resets only once the session has lasted (onClose)
          clearTimeout(retryTimer);
          retryTimer = null;
          loggedReason = '';
          log(`connected to halugraph (${label})`);
          return sock;
        },
        (err) => {
          connecting = null;
          failedAttempts += 1;
          const now = performance.now();
          // after a slow failure (a hung server) messages do not wait for another attempt; the background retry goes on
          holdUntil = now - started > 1000 ? now + RETRY_MAX_MS : 0;
          failure =
            err.status !== undefined && err.status !== 503
              ? { refused: true, message: `${err.message} — it may be older than this project's MCP relay. Use tools/cmd/halugraph-client instead (AGENTS.md).`, reason: err.detail || '' }
              : { message: NOT_RUNNING, reason: err.message };
          const text = failure.refused ? failure.message : failure.reason;
          if (text !== loggedReason) log(`halugraph is not reachable: ${text}`); // once per reason, not every retry
          loggedReason = text;
          throw err;
        },
      );
    }
    return connecting;
  }

  function scheduleRetry() {
    if (retryTimer || closing || conn || !root || !session.init) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect().catch(() => {
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
        scheduleRetry();
      });
    }, retryMs);
  }

  /** Session state the relay replays after a reconnect. */
  function remember(msg) {
    for (const m of each(msg)) {
      if (!m || typeof m !== 'object') continue;
      if (m.method === 'initialize' && 'id' in m) session.init = m;
      else if (m.method === 'notifications/initialized') session.initialized = m;
      else if (m.method === 'logging/setLevel' && 'id' in m) session.level = m;
      else if (m.method === 'resources/subscribe' && 'id' in m) {
        const uri = String(m.params?.uri);
        if (session.subscriptions.has(uri) || session.subscriptions.size < MAX_SUBSCRIPTIONS) session.subscriptions.set(uri, m);
      }
      else if (m.method === 'resources/unsubscribe') session.subscriptions.delete(String(m.params?.uri));
    }
  }

  function forward(sock, line, msg) {
    for (const m of each(msg)) {
      if (isRequest(m)) inflight.set(JSON.stringify(m.id), { id: m.id, method: m.method, params: m.method === 'initialize' ? m.params : undefined });
      else if (m && m.method === 'notifications/cancelled' && m.params) inflight.delete(JSON.stringify(m.params.requestId));
    }
    sock.cork();
    sock.write(line);
    const ok = sock.write(NL, sentDone);
    sock.uncork();
    if (sock.writableLength > limits.maxPendingBytes) return drop(sock, `halugraph does not take what the relay sends (${MB(sock.writableLength)} unsent)`);
    if (ok || stdinHolds.has('halugraph')) return;
    holdStdin('halugraph'); // halugraph is full: read no more from the client until it took this
    const done = () => {
      sock.off('drain', done);
      sock.off('close', done);
      releaseStdin('halugraph');
    };
    sock.on('drain', done);
    sock.on('close', done);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length && !closing) {
      const { line, msg, fails } = queue.shift();
      queuedBytes -= line.length;
      if (queuedBytes <= limits.maxQueueBytes / 2) releaseStdin('queue');
      let sock = conn;
      // no connection: try one now (halugraph may be back before the next background retry) unless held off —
      // or an attempt already failed while this message waited (a burst of messages costs one attempt, not one each)
      if (!sock && root && msg !== undefined && (connecting || (performance.now() >= holdUntil && fails === failedAttempts))) {
        sock = await connect().catch(() => null);
      }
      if (closing) break;
      if (sock) {
        debug(`→ halugraph: ${msg?.method || 'response'}${msg?.id !== undefined ? ` #${JSON.stringify(msg.id)}` : ''}`);
        forward(sock, line, msg);
      } else {
        debug(`answered offline: ${msg?.method || 'unparseable line'}`);
        const sent = answer(msg === undefined ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } : offlineAnswer(msg, failure));
        if (!sent) holdForStdout(process.stdin); // the client does not read its answers: read no more questions
      }
      remember(msg);
      if (!sock) scheduleRetry();
    }
    pumping = false;
  }

  /** Stop: close the connection (the last client messages first), then exit with `code`; 1 s at most. */
  function shutdown(why, code = 0) {
    if (closing) return;
    closing = true;
    debug(`stopping (${why})`);
    clearTimeout(retryTimer);
    clearInterval(watchdog);
    for (const w of [...privateWaits.values()]) w.reject(new Error('stopping'));
    const exit = () => {
      if (process.stdout.writableLength > 0 && !process.stdout.destroyed) process.stdout.once('drain', () => process.exit(code));
      else process.exit(code);
    };
    setTimeout(() => process.exit(code), 1000);
    const sock = conn;
    conn = null;
    if (sock && !sock.destroyed) {
      sock.once('close', exit);
      sock.end(() => sock.destroy()); // the last client messages first, then the end of the connection
    } else setImmediate(exit);
  }
  /** Stop because a limit was hit: said on stderr, exit code 1. */
  function stop(why) {
    if (closing) return;
    log(`${why}; stopping`);
    shutdown(why, 1);
  }

  // The watchdog: the agent CLI that started the relay may die without its stdin ever ending (another process
  // still holds the pipe), a client may stop reading, a halugraph may stop taking anything — and should anything
  // else pile up memory, it ends there. Unref'd: it never keeps the relay alive by itself.
  const startPpid = process.ppid;
  let outStalled = 0;
  let lastOut = -1;
  let sentStalled = 0;
  let lastSent = -1;
  watchdog = setInterval(() => {
    if (closing) return;
    if (parentGone(startPpid)) {
      log(`the agent CLI that started this relay (pid ${startPpid}) is gone; stopping`);
      return shutdown('the agent CLI is gone');
    }
    const rss = process.memoryUsage.rss();
    if (rss > limits.maxRssBytes) return stop(`the relay uses ${MB(rss)} of memory, over the limit of ${MB(limits.maxRssBytes)}`);
    // stdout: bytes wait, and the OS took none of them since the last look (counted in looks, not in time: a
    // relay stopped with its terminal's Ctrl+Z wakes up late once, not stalled)
    outStalled = process.stdout.writableLength > 0 && outTaken === lastOut ? outStalled + 1 : 0;
    lastOut = outTaken;
    if (outStalled * limits.watchdogMs >= limits.stallMs) return stop(`the agent CLI took nothing on stdout for ${limits.stallMs / 1000} s`);
    // halugraph: the same, unless it only waits for the client (stdout full → its connection is paused)
    const sock = conn;
    sentStalled = sock && sock.writableLength > 0 && sentTaken === lastSent && !outStalled ? sentStalled + 1 : 0;
    lastSent = sentTaken;
    if (sock && sentStalled * limits.watchdogMs >= limits.stallMs) {
      sentStalled = 0;
      drop(sock, `halugraph took nothing for ${limits.stallMs / 1000} s`);
    }
  }, limits.watchdogMs);
  watchdog.unref();

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => shutdown(signal));
  process.stdout.on('error', () => shutdown('stdout closed'));
  process.stderr.on('error', () => {});
  const fromClient = (line) => {
    if (isBlank(line)) return;
    let msg;
    try {
      msg = JSON.parse(line.toString('utf8'));
    } catch {
      msg = undefined; // not JSON: halugraph answers it with a parse error (or the relay does, offline)
    }
    queue.push({ line, msg, fails: failedAttempts });
    queuedBytes += line.length;
    if (queuedBytes > limits.maxQueueBytes) holdStdin('queue'); // waiting for a connection attempt: read on later
    pump();
  };
  /** A client line over the limit: never held or forwarded; its request (when its id shows) gets -32600. */
  const tooLong = (info) => {
    if (!info.ended) return log(`the agent CLI sent a line longer than ${MB(limits.maxClientLineBytes)}; dropped`);
    const message = `Message too large: ${info.bytes} bytes (the limit is ${limits.maxClientLineBytes} bytes). Send less data — e.g. keep long texts in a file.`;
    answer({ jsonrpc: '2.0', id: peekRequestId(info.head, info.tail), error: { code: -32600, message } });
  };
  process.stdin.on('data', lineSplitter(fromClient, { maxBytes: limits.maxClientLineBytes, onOversized: tooLong }));
  process.stdin.on('end', () => shutdown('end of stdin'));
  process.stdin.on('close', () => shutdown('stdin closed'));
  process.stdin.on('error', () => shutdown('stdin error'));
  if (typeof process.stdin.ref === 'function') process.stdin.ref(); // the relay lives exactly as long as its stdin
  debug(`started for ${root || '(no project)'} — node ${process.version}, pid ${process.pid}`);
}

if (!globalThis.__halugraphMcpRelayLibrary) main();
