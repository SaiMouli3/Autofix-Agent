"""
log_watcher.py — Server Log Monitor Agent + Auto-Restart
=========================================================
Flow:
  1. Starts the Flask backend automatically on launch
  2. Every 3s — read NEW lines from server.log
  3. Send ALL new lines to DeepSeek-V3 for analysis
  4. DeepSeek returns: { has_error, status_codes, trigger_autofix, summary }
  5. If trigger_autofix == true  →  run autofix.py
  6. After autofix rewrites app.py  →  restart Flask automatically
  7. Also watches app.py mtime — restarts Flask on ANY file change

Usage:  python log_watcher.py
Stop:   Ctrl+C
"""

import boto3
import json
import os
import sys
import re
import time
import subprocess
import signal
import atexit
from pathlib import Path
from datetime import datetime

# ==========================================
# Config
# ==========================================
MODEL_ID = "deepseek.v3-v1:0"   # DeepSeek-V3.1

LOG_FILE       = Path(r"E:\Downloads\Autofix-Agent-master\Autofix-Agent-master\ecommerce\backend\server.log")
APP_FILE       = Path(r"E:\Downloads\Autofix-Agent-master\Autofix-Agent-master\ecommerce\backend\app.py")
APP_DIR        = APP_FILE.parent
REPO_DIR       = r"E:\Downloads\Autofix-Agent-master\Autofix-Agent-master\ecommerce"
SERVICE_NAME   = "ecommerce-flask"
PYTHONPATH     = r"C:\Users\ADMIN\Desktop\grab hack 2.0\Incident_iq\incidentiq\incidentiq"
AUTOFIX_SCRIPT = str(Path(PYTHONPATH) / "scripts" / "autofix.py")
FLASK_PORT     = 5000

POLL_SECONDS = 3    # how often to check the log
COOLDOWN     = 30   # min seconds between autofix runs

# ==========================================
# AWS credentials
# ==========================================
os.environ["AWS_DEFAULT_REGION"]    = "us-west-2"
os.environ["AWS_ACCESS_KEY_ID"]     = "ASIATW23DPKKO37RNX27"
os.environ["AWS_SECRET_ACCESS_KEY"] = "pb2X1JUanqxRnXYEva+/Dqg/gKxd/ZhTsiRPEktI"
os.environ["AWS_SESSION_TOKEN"]     = (
    "IQoJb3JpZ2luX2VjEMH//////////wEaCXVzLWVhc3QtMSJHMEUCIQCOtsWNjI8Atrx5RWnlyheT"
    "+q1lMvKbbF1C1D3fr0QOcQIgblfSWUNMPGgOZ1vXVlsn52KSsQka7wYn78kflJL3w+8qogIIiv//"
    "////////ARACGgwyNTUyMDQ3NTIwMjAiDJoeE/2xuQcoW+5rIir2AQfG+mU1AAxIw5Xr/oNbnr3m"
    "7gf6j+p60fYl22/3jupOx33tW/Z6epdNvXRB9V2/Foh6o8NpSrLt18qkPlQTY/Hya8v4F3ZNZczG"
    "sI466qsPnn4tb00EjQF/oc7R3DRYicSJc0sqb6ixgHfDkrpQSK8YE+uIazFZpNns5zK55gFP361c"
    "y0W7H2mK6jIiSx65/03e6GNTpXCA5O9qkuP40cI0mv9FObDPqhf1/9sMUyJGvI7/lnbliCrEoMWQ"
    "kgx/9vH8O5sy4UoP0lU4MQIog3S8yP5wl679um9dwGeqjbt9I6cCmc594Pc+PCuLTzHS8vVF9OhZ5"
    "TC93qDQBjqdAQO75CM2/fdejX34dm5msfKNkWvWOAu9/UV+ghBvPItcZlJeTvYzrEKQRuyiLe8g/K"
    "U7V8Y4BG2fV/AnQXFtnu+P+38PCZyl6/30FELGqdQe4EGmWF/3ixW4Wdnxr6iUAzcEIsk9zKnQs6"
    "H6Dq7YwLpU3drDWaZJMvRAY7/fSrN7SioiVGPTIkDVjBXC2kkzx06gul2PTnS6S4n/OZ8="
)

# ==========================================
# Bedrock client
# ==========================================
bedrock = boto3.client(
    service_name="bedrock-runtime",
    region_name="us-west-2"
)

# ==========================================
# Helpers
# ==========================================
_ANSI = re.compile(r'\x1b\[[0-9;]*m')

def ts():
    return datetime.now().strftime("%H:%M:%S")

def clean(line: str) -> str:
    return _ANSI.sub("", line).strip()

# ==========================================
# Flask server manager
# ==========================================
_flask_proc: subprocess.Popen = None
_app_mtime  = 0.0


def start_flask():
    """Start the Flask backend as a subprocess."""
    global _flask_proc, _app_mtime

    if not APP_FILE.exists():
        print(f"  [{ts()}] ❌ app.py not found: {APP_FILE}")
        return

    # Kill existing process if running
    stop_flask()

    print(f"  [{ts()}] 🚀 Starting Flask server (port {FLASK_PORT}) ...")
    env = os.environ.copy()
    env["FLASK_ENV"] = "development"

    _flask_proc = subprocess.Popen(
        [sys.executable, str(APP_FILE)],
        cwd=str(APP_DIR),
        env=env,
        # Don't capture — let Flask write directly to its own server.log
    )
    _app_mtime = APP_FILE.stat().st_mtime
    print(f"  [{ts()}] ✅ Flask started  (PID {_flask_proc.pid})")


def stop_flask():
    """Kill the running Flask process."""
    global _flask_proc
    if _flask_proc is None:
        return
    if _flask_proc.poll() is not None:
        # Already exited
        _flask_proc = None
        return
    print(f"  [{ts()}] 🛑 Stopping Flask (PID {_flask_proc.pid}) ...")
    try:
        _flask_proc.terminate()
        _flask_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _flask_proc.kill()
        _flask_proc.wait()
    _flask_proc = None
    print(f"  [{ts()}] ✅ Flask stopped")


def restart_flask(reason: str = ""):
    print(f"\n  [{ts()}] 🔄 Restarting Flask{' — ' + reason if reason else ''} ...")
    start_flask()
    # Reset log offset so we read fresh logs from the new process
    global _last_size
    time.sleep(1)   # brief pause for Flask to write startup lines
    if LOG_FILE.exists():
        _last_size = LOG_FILE.stat().st_size
        print(f"  [{ts()}] 📋 Log offset reset to {_last_size} bytes")


def check_app_changed() -> bool:
    """Returns True if app.py was modified since last check."""
    global _app_mtime
    if not APP_FILE.exists():
        return False
    mtime = APP_FILE.stat().st_mtime
    if mtime != _app_mtime:
        _app_mtime = mtime
        return True
    return False


def flask_alive() -> bool:
    """Returns True if the Flask process is still running."""
    return _flask_proc is not None and _flask_proc.poll() is None


# Kill Flask on watcher exit
atexit.register(stop_flask)

# ==========================================
# Read new lines from log (byte-offset)
# ==========================================
_last_size = 0

def read_new_lines() -> list[str]:
    global _last_size
    if not LOG_FILE.exists():
        return []
    size = LOG_FILE.stat().st_size
    if size == _last_size:
        return []
    if size < _last_size:       # log rotated / cleared
        _last_size = 0
    with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
        f.seek(_last_size)
        content = f.read()
    _last_size = size
    return [clean(l) for l in content.splitlines() if clean(l)]

# ==========================================
# Send ALL new lines to DeepSeek for analysis
# ==========================================
def ask_deepseek(new_lines: list[str]) -> dict:
    """
    Sends every new log line to DeepSeek-V3.
    Returns:
      {
        "has_error": true/false,
        "status_codes": [400, 500, ...],
        "trigger_autofix": true/false,
        "summary": "one sentence"
      }
    """
    log_text = "\n".join(new_lines)

    prompt = (
        "You are a server log analysis agent for a Flask ecommerce app.\n"
        "Analyse the following NEW server log lines.\n"
        "Look for any HTTP 4xx or 5xx status codes, Python exceptions, or error keywords.\n\n"
        f"Log lines:\n{log_text}\n\n"
        "Reply with ONLY valid JSON — no markdown, no explanation:\n"
        "{\n"
        '  "has_error": true or false,\n'
        '  "status_codes": [list of integer HTTP error codes found, e.g. 400, 404, 500],\n'
        '  "trigger_autofix": true if any 4xx or 5xx status code is present OR if there are Python exceptions/tracebacks, else false,\n'
        '  "summary": "one sentence describing what happened"\n'
        "}"
    )

    body = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.0,
    }

    try:
        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        response_body = json.loads(response["body"].read())
        text = response_body["choices"][0]["message"]["content"].strip()

        # Strip markdown fences if model added them
        if "```" in text:
            for part in text.split("```"):
                part = part.strip().lstrip("json").strip()
                if part.startswith("{"):
                    text = part
                    break

        return json.loads(text)

    except json.JSONDecodeError:
        combined = " ".join(new_lines)
        codes = re.findall(r'\b([45]\d{2})\b', combined)
        has_err = bool(codes) or any(k in combined for k in ["Exception", "Traceback", "[ERROR]"])
        return {
            "has_error": has_err,
            "status_codes": [int(c) for c in set(codes)],
            "trigger_autofix": has_err,
            "summary": f"(local fallback) codes={codes}",
        }
    except Exception as e:
        print(f"  [{ts()}] ⚠️  DeepSeek error: {e}")
        return {"has_error": False, "status_codes": [], "trigger_autofix": False,
                "summary": f"DeepSeek unavailable: {e}"}

# ==========================================
# Trigger autofix.py  →  then restart Flask
# ==========================================
_last_fix_time = 0.0

def run_autofix():
    global _last_fix_time

    elapsed = time.time() - _last_fix_time
    if elapsed < COOLDOWN:
        print(f"  [{ts()}] ⏳ Cooldown — {int(COOLDOWN - elapsed)}s left, skipping")
        return

    print(f"\n  [{ts()}] 🔧 Running autofix.py ...")

    env = os.environ.copy()
    env["PYTHONPATH"] = PYTHONPATH

    cmd = [
        sys.executable, AUTOFIX_SCRIPT,
        "--repo",    REPO_DIR,
        "--log",     str(LOG_FILE),
        "--service", SERVICE_NAME,
    ]
    print(f"  CMD: {' '.join(cmd)}\n")

    try:
        result = subprocess.run(cmd, env=env, text=True)
        _last_fix_time = time.time()
        if result.returncode == 0:
            print(f"\n  [{ts()}] ✅ autofix.py completed")
        else:
            print(f"\n  [{ts()}] ⚠️  autofix.py exited {result.returncode}")
    except FileNotFoundError:
        print(f"  [{ts()}] ❌ Not found: {AUTOFIX_SCRIPT}")
        return
    except Exception as e:
        print(f"  [{ts()}] ❌ autofix error: {e}")
        return

    # autofix may have rewritten app.py — restart Flask with the fixed code
    restart_flask(reason="autofix rewrote app.py")

# ==========================================
# Process a batch of new log lines
# ==========================================
def process(new_lines: list[str], label: str = "NEW"):
    print(f"\n  [{ts()}] 📄 [{label}] {len(new_lines)} line(s) — sending to DeepSeek ...")
    for line in new_lines:
        print(f"       {line[:115]}")

    verdict = ask_deepseek(new_lines)

    codes_str = ", ".join(str(c) for c in verdict.get("status_codes", [])) or "none"
    print(f"\n  ┌─ DeepSeek Verdict ──────────────────────────────")
    print(f"  │  Summary        : {verdict.get('summary')}")
    print(f"  │  Has error      : {verdict.get('has_error')}")
    print(f"  │  Status codes   : {codes_str}")
    print(f"  │  Trigger autofix: {verdict.get('trigger_autofix')}")
    print(f"  └─────────────────────────────────────────────────\n")

    if verdict.get("trigger_autofix"):
        run_autofix()
    else:
        print(f"  [{ts()}] ℹ️  No 4xx/5xx — watching ...\n")

# ==========================================
# Main
# ==========================================
def main():
    global _last_size

    print("=" * 54)
    print("  Server Log Monitor Agent + Auto-Restart")
    print("=" * 54)
    print(f"  App    : {APP_FILE}")
    print(f"  Log    : {LOG_FILE}")
    print(f"  Model  : {MODEL_ID}")
    print(f"  Poll   : every {POLL_SECONDS}s")
    print(f"  Rule   : new log lines → DeepSeek → autofix if 4xx/5xx → restart Flask")
    print(f"  Also   : restarts Flask whenever app.py changes on disk")
    print("=" * 54)

    # ── Start Flask immediately ───────────────────────────────────────────────
    start_flask()
    time.sleep(2)   # let Flask write its startup lines

    # ── Startup: scan existing log ────────────────────────────────────────────
    print(f"\n  [{ts()}] 🔍 Scanning existing log ...")
    if LOG_FILE.exists():
        with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
            content = f.read()
        _last_size = LOG_FILE.stat().st_size
        all_lines  = [clean(l) for l in content.splitlines() if clean(l)]
        print(f"  [{ts()}] {len(all_lines)} lines, {_last_size} bytes")
        if all_lines:
            process(all_lines, label="STARTUP")
        else:
            print(f"  [{ts()}] Log is empty")
    else:
        print(f"  [{ts()}] Log not found yet")
        _last_size = 0

    # ── Live watch loop ───────────────────────────────────────────────────────
    print(f"\n  [{ts()}] 👁  Watching every {POLL_SECONDS}s ... (Ctrl+C to stop)\n")

    tick = 0
    while True:
        try:
            time.sleep(POLL_SECONDS)
            tick += 1

            # ── Check if Flask crashed — restart it ───────────────────────────
            if not flask_alive():
                print(f"  [{ts()}] ⚠️  Flask process died — restarting ...")
                restart_flask(reason="process died")

            # ── Check if app.py changed on disk (e.g. autofix rewrote it) ────
            if check_app_changed():
                print(f"  [{ts()}] 📝 app.py changed on disk")
                restart_flask(reason="app.py modified")

            # ── Read new log lines ────────────────────────────────────────────
            new_lines = read_new_lines()

            if tick % 10 == 0:
                print(f"  [{ts()}] 💓 watching ...  Flask alive={flask_alive()}")

            if not new_lines:
                continue

            process(new_lines, label="NEW")

        except KeyboardInterrupt:
            print(f"\n\n  [{ts()}] 🛑 Agent stopped.")
            stop_flask()
            sys.exit(0)
        except Exception as e:
            print(f"  [{ts()}] ⚠️  Loop error (continuing): {e}")


if __name__ == "__main__":
    main()
