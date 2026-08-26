<!-- Mirrored from Global Bridge/docs/SERVED_APPS.md so this repo carries its own
     integration notes. Helios lives outside this repo and is not versioned with
     it; if you change the contract, change both. -->

# Wiring a plain web server into Helios

Read this before adding an app that is **a web server, not an Electron window**
— a static site, a dev server, a Python API. `REMOTE_CONTROL.md` covers the
Electron/CDP case; this is the other one, and it is simpler: Helios needs a port
to watch and a way to stop you politely.

The worked example is **Arcade** (`Misc\Games`), added Aug 2026.

---

## The registry entry

```json
{
  "id": "arcade",
  "name": "Arcade",
  "path": "C:\\Users\\Gustavo Abreu\\Documents\\Misc\\Games",
  "startFile": "start.bat",
  "cdpPort": 0,
  "httpPort": 8123,
  "type": "python-server",
  "icon": "arcade"
}
```

- **`cdpPort: 0`** — there is no window to drive. Helios skips every CDP path
  when this is falsy and watches `httpPort` instead.
- **`type: "python-server"`** is what earns the polite shutdown below. Without
  it, stopping the app goes straight to killing whatever holds the port.
- **`icon`** is `src/icons/<name>.png` at **256×256**, matching the others.
- `apps.json` is read from disk on **every** call to `loadAppsRegistry()`, so a
  new entry appears without restarting Helios. The tray and the phone panel pick
  it up on their next poll.

## The two endpoints Helios speaks

**`GET /api/status` → any JSON.** This is the liveness check
(`main.js`, the status sweep). Returning valid JSON means running; Helios falls
back to a raw TCP ping if the endpoint is missing, so a server without it still
shows up — it just cannot say anything about itself.

**`POST /api/shutdown`.** Only used when `type` is `python-server`. Helios posts
`{}` with a 3s timeout and, if that fails, force-kills whatever is listening on
`httpPort`. Answer *before* you stop, and stop on another thread — calling
`shutdown()` inline deadlocks the handler serving the request.

## The LNK button, and why the root matters

Any app with an `httpPort` gets a **LNK** button that copies its phone URL. That
URL is built by `remoteUrl()` in `src/js/renderer.js` as:

```
http://<tailscale-ip>:<httpPort>
```

— the **bare root**, with no path. There is no field for a path, so if the thing
worth opening lives at `/somewhere/`, redirect `/` to it in your own server.
Arcade does exactly that (302 to `/arcade/`), which is why its copied link opens
the launcher rather than a directory listing. Changing `remoteUrl()` to support a
path would work too; redirecting is less code and cannot break the other apps.

## The trap that will cost you an hour

**Launched through `pythonw`, `sys.stdout` is `None`.**

`print()` tolerates this — CPython returns early when the stream is `None`. A
bare `sys.stdout.write(...)` does **not**, and if it sits in a per-request path
like a logging hook, every single response dies while the socket keeps
accepting connections.

The failure looks like this, and it looks like nothing:

```
netstat  -> LISTENING          (the port is open)
curl     -> empty response     (every request, including /api/status)
```

Helios then reports the app as stopped even though the process is alive, because
its liveness check is one of the requests that dies. Run the server by hand with
`python` once — you will see the traceback that `pythonw` swallowed.

Guard any logging hook:

```python
def log_message(self, fmt, *args):
    if sys.stdout is None:
        return
    try:
        print("  %s" % (fmt % args))
    except Exception:
        pass
```

## Checklist

1. Server binds **`0.0.0.0`**, not `127.0.0.1`, or the phone cannot reach it.
2. `GET /api/status` returns JSON; `POST /api/shutdown` answers then stops.
3. `/` redirects to whatever the LNK button should open.
4. No bare `sys.stdout.write` anywhere in a request path.
5. Icon at `src/icons/<id>.png`, 256×256.
6. Windows firewall will prompt on the first bind — allow private networks.
