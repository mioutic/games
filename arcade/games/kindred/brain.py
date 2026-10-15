"""The villagers' voice: one short line at a time from the cheapest Claude model.

serve.py mounts this at POST /api/brain. A game sends a fixed system prompt
(its world and rules) and a short scene (who is near, what just happened), and
gets back the model's text. The game decides when to ask; this module only
makes the call cheap and fast.

The approach is Eliza's quick voice (Misc/Eliza/core/ack.js): run the Claude
Code CLI headless on the existing login, with every tool, MCP server, hook,
skill and slash command switched off, thinking off, and our own system prompt
*replacing* Claude Code's (which is ~15k tokens and would cost seconds a call).
No API key: it spends the same subscription the CLI is signed in with.

Starting claude.exe costs ~2.4s, so a process is started ahead of time and left
waiting on stdin. A request takes the waiting one, writes the scene, reads the
result, and a fresh one is started behind it. Each process answers exactly one
turn and exits; the scene carries all the context, so nothing persists.

Nothing here can run code on this machine: the model gets `--tools ""`, and the
only model allowed is Haiku. The endpoint sits behind serve.py's loopback +
tailnet check like every other path.
"""

import glob
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time

MODEL = os.environ.get("ARCADE_BRAIN_MODEL", "haiku")   # the lowest tier; an alias the CLI resolves
LIMIT_S = 14            # give up on one answer after this
WARM_MAX_S = 15 * 60    # a waiting process older than this is replaced
IDLE_S = 10 * 60        # stop keeping one waiting after this long without a request
MAX_CONCURRENT = 3      # in-flight calls at once
PER_MINUTE = 30         # hard ceiling, so a runaway loop cannot drain the plan
MAX_SYS = 8000
MAX_MSG = 6000

NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def _say(*a):
    # Under pythonw there is no stdout at all (see serve.py's log_message).
    try:
        print("  brain:", *a)
    except Exception:
        pass


def _ver(path):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", path)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def resolve_binary():
    """The newest claude.exe on this machine, the same places Eliza looks."""
    env = os.environ.get("ARCADE_CLAUDE_EXE")
    if env and os.path.exists(env):
        return env
    home = os.path.expanduser("~")
    cands = glob.glob(os.path.join(home, ".vscode", "extensions", "anthropic.claude-code-*",
                                   "resources", "native-binary", "claude.exe"))
    appdata = os.environ.get("APPDATA")
    if appdata:
        cands += glob.glob(os.path.join(appdata, "Claude", "claude-code", "*", "claude.exe"))
    cands = [c for c in cands if os.path.exists(c)]
    if cands:
        return max(cands, key=_ver)
    return shutil.which("claude")


def child_env():
    env = dict(os.environ)
    # Started from inside a Claude Code session (or a Helios launch of one),
    # these would make the child think it is nested and change its behaviour.
    for k in list(env):
        if k == "CLAUDECODE" or k in ("CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"):
            env.pop(k, None)
    env.update({"MAX_THINKING_TOKENS": "0", "ENABLE_TOOL_SEARCH": "false",
                "DISABLE_AUTOUPDATER": "1"})
    return env


def _args(system):
    return ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
            "--model", MODEL, "--system-prompt", system,
            "--strict-mcp-config", "--tools", "",
            "--no-session-persistence", "--max-turns", "1", "--disable-slash-commands",
            "--settings", json.dumps({"alwaysThinkingEnabled": False, "disableAllHooks": True})]


class Proc:
    """One claude.exe waiting for exactly one scene."""

    def __init__(self, exe, system, cwd):
        self.at = time.time()
        self.lines = queue.Queue()
        self.p = subprocess.Popen([exe] + _args(system), cwd=cwd, env=child_env(),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                                  errors="replace", creationflags=NO_WINDOW)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        try:
            for line in self.p.stdout:
                self.lines.put(line)
        except Exception:
            pass
        self.lines.put(None)

    def alive(self):
        return self.p.poll() is None

    def ask(self, msg, limit=LIMIT_S):
        self.p.stdin.write(json.dumps({"type": "user",
                                       "message": {"role": "user", "content": msg}}) + "\n")
        self.p.stdin.flush()
        self.p.stdin.close()
        end = time.time() + limit
        model = None
        while True:
            left = end - time.time()
            if left <= 0:
                self.stop()
                return {"ok": False, "error": "timeout"}
            try:
                line = self.lines.get(timeout=left)
            except queue.Empty:
                continue
            if line is None:
                return {"ok": False, "error": "process ended without an answer"}
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                model = ev.get("model")
            if ev.get("type") == "result":
                self.stop()
                if ev.get("is_error"):
                    return {"ok": False, "error": str(ev.get("result") or ev.get("subtype"))[:300]}
                return {"ok": True, "text": ev.get("result") or "", "model": model,
                        "costUsd": ev.get("total_cost_usd"), "apiMs": ev.get("duration_api_ms")}

    def stop(self):
        # Only ever our own child, by its own handle (never by image name).
        try:
            if self.p.poll() is None:
                self.p.kill()
        except Exception:
            pass


class Brain:
    def __init__(self, cwd=None):
        self.exe = resolve_binary()
        self.cwd = cwd or os.environ.get("TEMP") or os.getcwd()
        self.lock = threading.Lock()
        self.warm = {}            # system-prompt hash -> Proc
        self.last_req = 0.0
        self.calls = []           # timestamps, for the per-minute ceiling
        self.gate = threading.Semaphore(MAX_CONCURRENT)
        threading.Thread(target=self._reap, daemon=True).start()
        self.stats = {"calls": 0, "answered": 0, "failed": 0, "warmHits": 0, "costUsd": 0.0,
                      "lastMs": None, "lastModel": None, "lastError": None}

    def status(self):
        out = dict(self.stats)
        out.update({"ok": bool(self.exe), "model": MODEL, "binary": bool(self.exe), "warm": len(self.warm)})
        return out

    def _key(self, system):
        return hashlib.sha1(system.encode("utf-8")).hexdigest()[:12]

    def _reap(self):
        """Every minute: let go of a waiting process nobody has asked for lately."""
        while True:
            time.sleep(60)
            now = time.time()
            with self.lock:
                stale = [k for k, p in self.warm.items()
                         if not p.alive() or now - p.at > WARM_MAX_S or now - self.last_req > IDLE_S]
                procs = [self.warm.pop(k) for k in stale]
            for p in procs:
                p.stop()

    def _prewarm(self, system):
        key = self._key(system)
        with self.lock:
            if key in self.warm or time.time() - self.last_req > IDLE_S:
                return
            # One waiting process at a time: a changed prompt retires the old one.
            for k in [k for k in self.warm if k != key]:
                self.warm.pop(k).stop()
            try:
                self.warm[key] = Proc(self.exe, system, self.cwd)
            except Exception as e:
                self.stats["lastError"] = "spawn: %s" % e

    def _take(self, system):
        key = self._key(system)
        with self.lock:
            p = self.warm.pop(key, None)
        if p and p.alive() and time.time() - p.at < WARM_MAX_S:
            self.stats["warmHits"] += 1
            return p
        if p:
            p.stop()
        return Proc(self.exe, system, self.cwd)

    def ask(self, system, msg):
        if not self.exe:
            return {"ok": False, "error": "claude.exe not found on this machine"}
        system = str(system or "")[:MAX_SYS]
        msg = str(msg or "")[:MAX_MSG]
        if not msg.strip():
            return {"ok": False, "error": "empty scene"}
        now = time.time()
        with self.lock:
            self.calls = [t for t in self.calls if now - t < 60]
            if len(self.calls) >= PER_MINUTE:
                return {"ok": False, "error": "rate limit (%d a minute)" % PER_MINUTE}
            self.calls.append(now)
            self.last_req = now
        if not self.gate.acquire(timeout=LIMIT_S):
            return {"ok": False, "error": "busy"}
        try:
            t0 = time.time()
            try:
                p = self._take(system)
            except Exception as e:
                return {"ok": False, "error": "spawn: %s" % e}
            # The next scene's process starts while this one is being answered.
            threading.Thread(target=self._prewarm, args=(system,), daemon=True).start()
            out = p.ask(msg)
            ms = int((time.time() - t0) * 1000)
            out["ms"] = ms
            self.stats["calls"] += 1
            self.stats["lastMs"] = ms
            if out.get("ok"):
                self.stats["answered"] += 1
                self.stats["lastModel"] = out.get("model")
                self.stats["costUsd"] = round(self.stats["costUsd"] + (out.get("costUsd") or 0), 5)
            else:
                self.stats["failed"] += 1
                self.stats["lastError"] = out.get("error")
            return out
        finally:
            self.gate.release()

    def warmup(self, system):
        """A game calls this on load, so the first line someone speaks is quick."""
        self.last_req = time.time()
        threading.Thread(target=self._prewarm, args=(str(system or "")[:MAX_SYS],),
                         daemon=True).start()
        return self.status()

    def close(self):
        with self.lock:
            procs, self.warm = list(self.warm.values()), {}
        for p in procs:
            p.stop()


if __name__ == "__main__":
    # python arcade/games/kindred/brain.py   -> one cold call and one warm call, timed
    b = Brain()
    print("binary:", b.exe)
    sys_ = "You are Wren, a villager. Reply with one short spoken line, under 12 words."
    b.warmup(sys_)
    for scene in ("A stranger waves at you.", "The stranger says: where is the fire?"):
        time.sleep(4)
        r = b.ask(sys_, scene)
        print(r.get("ms"), "ms", r.get("model"), "|", r.get("text") or r.get("error"))
    b.close()
