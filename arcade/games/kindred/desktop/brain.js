// The villagers' voice for the desktop build: ../brain.py, in Node, in-process.
//
// Same approach (Eliza's quick voice, Misc/Eliza/core/ack.js): the Claude Code
// CLI headless on this machine's existing login, every tool, MCP server, hook
// and slash command off, thinking off, our system prompt replacing Claude
// Code's, Haiku only. One process is started ahead and waits on stdin, so a
// line costs the model's time, not claude.exe's start-up. Each process answers
// one scene and exits. Nothing here opens a port.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL = process.env.KINDRED_BRAIN_MODEL || 'haiku';
const LIMIT_MS = 16000, WARM_MAX_MS = 15 * 60e3, IDLE_MS = 10 * 60e3, PER_MINUTE = 30, MAX_CONCURRENT = 3;
const MAX_SYS = 8000, MAX_MSG = 6000;

function ver(p) { const m = /(\d+)\.(\d+)\.(\d+)/.exec(p); return m ? m.slice(1).map(Number) : [0, 0, 0]; }
function newer(a, b) { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }

function resolveBinary() {
  if (process.env.KINDRED_CLAUDE_EXE && fs.existsSync(process.env.KINDRED_CLAUDE_EXE)) return process.env.KINDRED_CLAUDE_EXE;
  const cands = [];
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  try { for (const d of fs.readdirSync(ext)) if (d.startsWith('anthropic.claude-code-')) cands.push(path.join(ext, d, 'resources', 'native-binary', 'claude.exe')); } catch (e) {}
  const cc = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  try { for (const d of fs.readdirSync(cc)) cands.push(path.join(cc, d, 'claude.exe')); } catch (e) {}
  let best = null;
  for (const c of cands) if (fs.existsSync(c) && (!best || newer(c, best))) best = c;
  if (best) return best;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const c = path.join(dir, 'claude.exe'); if (fs.existsSync(c)) return c;
  }
  return null;
}

function childEnv() {
  const env = { ...process.env };
  // Started from a Claude Code session these would make the child think it is nested.
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  return Object.assign(env, { MAX_THINKING_TOKENS: '0', ENABLE_TOOL_SEARCH: 'false', DISABLE_AUTOUPDATER: '1' });
}

function args(system) {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', MODEL, '--system-prompt', system, '--strict-mcp-config', '--tools', '',
    '--no-session-persistence', '--max-turns', '1', '--disable-slash-commands',
    '--settings', JSON.stringify({ alwaysThinkingEnabled: false, disableAllHooks: true })];
}

class Proc {
  constructor(exe, system) {
    this.at = Date.now(); this.lines = []; this.waiter = null; this.ended = false; this.buf = '';
    this.p = spawn(exe, args(system), { cwd: os.tmpdir(), env: childEnv(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.p.stdout.setEncoding('utf8');
    this.p.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { this.push(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 1); }
    });
    this.p.on('exit', () => { this.ended = true; this.push(null); });
    this.p.on('error', () => { this.ended = true; this.push(null); });
  }
  push(line) { if (this.waiter) { const w = this.waiter; this.waiter = null; w(line); } else this.lines.push(line); }
  next(ms) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((res) => { const t = setTimeout(() => { this.waiter = null; res(undefined); }, ms); this.waiter = (l) => { clearTimeout(t); res(l); }; });
  }
  alive() { return !this.ended && this.p.exitCode === null; }
  async ask(msg) {
    try { this.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: msg } }) + '\n'); this.p.stdin.end(); }
    catch (e) { return { ok: false, error: 'write: ' + e.message }; }
    const end = Date.now() + LIMIT_MS; let model = null;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0) { this.stop(); return { ok: false, error: 'timeout' }; }
      const line = await this.next(left);
      if (line === undefined) continue;
      if (line === null) return { ok: false, error: 'process ended without an answer' };
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      if (ev.type === 'system' && ev.subtype === 'init') model = ev.model;
      if (ev.type === 'result') {
        this.stop();
        if (ev.is_error) return { ok: false, error: String(ev.result || ev.subtype).slice(0, 300) };
        return { ok: true, text: ev.result || '', model, costUsd: ev.total_cost_usd, apiMs: ev.duration_api_ms };
      }
    }
  }
  stop() { try { if (this.alive()) this.p.kill(); } catch (e) {} }   // our own child, by its handle
}

const exe = resolveBinary();
let warm = null, warmKey = null, lastReq = 0, calls = [], inflight = 0;
const stats = { calls: 0, answered: 0, failed: 0, warmHits: 0, costUsd: 0, lastMs: null, lastModel: null, lastError: null };
const key = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function prewarm(system) {
  if (!exe || Date.now() - lastReq > IDLE_MS) return;
  const k = key(system);
  if (warm && warmKey === k && warm.alive()) return;
  if (warm) warm.stop();
  try { warm = new Proc(exe, system); warmKey = k; } catch (e) { warm = null; stats.lastError = 'spawn: ' + e.message; }
}
function take(system) {
  const k = key(system), p = warm;
  warm = null;
  if (p && warmKey === k && p.alive() && Date.now() - p.at < WARM_MAX_MS) { stats.warmHits++; return p; }
  if (p) p.stop();
  return new Proc(exe, system);
}
setInterval(() => {                    // let go of a waiting process nobody has asked for lately
  if (warm && (!warm.alive() || Date.now() - warm.at > WARM_MAX_MS || Date.now() - lastReq > IDLE_MS)) { warm.stop(); warm = null; }
}, 60e3).unref();

function status() { return Object.assign({}, stats, { ok: !!exe, binary: !!exe, model: MODEL, warm: warm ? 1 : 0 }); }

async function ask(system, msg) {
  if (!exe) return { ok: false, error: 'claude.exe not found on this machine' };
  system = String(system || '').slice(0, MAX_SYS); msg = String(msg || '').slice(0, MAX_MSG);
  if (!msg.trim()) return { ok: false, error: 'empty scene' };
  const now = Date.now();
  calls = calls.filter((t) => now - t < 60e3);
  if (calls.length >= PER_MINUTE) return { ok: false, error: 'rate limit (' + PER_MINUTE + ' a minute)' };
  if (inflight >= MAX_CONCURRENT) return { ok: false, error: 'busy' };
  calls.push(now); lastReq = now; inflight++;
  try {
    const t0 = Date.now(), p = take(system);
    setTimeout(() => prewarm(system), 0);   // the next scene's process starts while this one answers
    const out = await p.ask(msg);
    out.ms = Date.now() - t0;
    stats.calls++; stats.lastMs = out.ms;
    if (out.ok) { stats.answered++; stats.lastModel = out.model; stats.costUsd = +(stats.costUsd + (out.costUsd || 0)).toFixed(5); }
    else { stats.failed++; stats.lastError = out.error; }
    return out;
  } catch (e) { stats.failed++; stats.lastError = e.message; return { ok: false, error: e.message }; }
  finally { inflight--; }
}

function warmup(system) { lastReq = Date.now(); prewarm(String(system || '').slice(0, MAX_SYS)); return status(); }
function close() { if (warm) { warm.stop(); warm = null; } }

module.exports = { ask, warmup, status, close, MODEL, exe };
