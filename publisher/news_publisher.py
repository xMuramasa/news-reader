#!/usr/bin/env python3
"""news_publisher: publish new Hermes briefing runs to the news reader.

Runs as a Hermes cron job in script mode (no agent) every 5 minutes. For each new run archive of the Chile, Cyber
and AI briefing jobs it extracts the final answer, parses the edition JSON, adds `source_run` and `generated_at`,
and POSTs it to the reader's ingest API. Whatever it prints on stdout is delivered to Telegram by Hermes; empty
stdout means no message.

Python 3 standard library only. Source of truth: news-reader/publisher/news_publisher.py (copied into
~/.hermes/scripts/ by `bun run install:publisher`). See SPEC.md, "Publisher".
"""
from __future__ import annotations

import datetime as dt
import fcntl
import http.client
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request

# Mirrors FEEDS in packages/schema/src/feeds.ts (a test checks they agree).
FEEDS = {
    "7a38c16d35fd": {"feed": "chile", "label": "Chile", "emoji": "\U0001F1E8\U0001F1F1", "message_sections": ["top"]},
    "d3a7c91070f7": {"feed": "cyber", "label": "Cyber", "emoji": "\U0001F6E1️", "message_sections": ["patch_now", "top"]},
    "7e15c4016256": {"feed": "ai", "label": "AI", "emoji": "\U0001F916", "message_sections": ["top"]},
}

RUN_FILE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$")
DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

POST_TIMEOUT = 10  # seconds per request
RUN_BUDGET = 40  # stop starting new POSTs after this many seconds (Hermes ticks every 5 minutes)
SETTLE_SECONDS = 30  # leave archives alone right after they were written
TRUNCATED_GRACE = 15 * 60  # a run whose archive is still truncated after this long is reported broken
FALLBACK_AFTER = 2 * 3600  # unpublished this long after the run: send the locally built message
MAX_MESSAGE = 3500
MAX_STORY_LINES = 7
MAX_RESPONSE_BYTES = 1_000_000

DONE = {"published", "failed", "silent", "skipped_legacy"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# ---------------------------------------------------------------------------------------------------------------
# Answer extraction: the same logic as Hermes' `_archive_answer` (length frames first, legacy `## Response`
# fallback, a truncated frame is unusable), but telling "silent" and "unusable" apart.

_PROMPT_FRAME = "**Prompt Characters:** "
_RESPONSE_FRAME = "**Response Characters:** "
_PROMPT_HEADING = "## Prompt\n\n"
_RESPONSE_HEADING = "## Response\n\n"
_PROMPT_SEPARATOR = "\n\n"
_RESPONSE_TERMINATOR = "\n"
_PROMPT_FRAME_RE = re.compile(rf"(?m)^{re.escape(_PROMPT_FRAME)}(\d+)\n{re.escape(_PROMPT_HEADING)}")
_RESPONSE_FRAME_RE = re.compile(rf"(?m)^{re.escape(_RESPONSE_FRAME)}(\d+)\n{re.escape(_RESPONSE_HEADING)}")

SILENT_TOKENS = {"[silent]", "silent", "no_reply", "no reply"}


def is_silent(text: str) -> bool:
    t = text.strip()
    if not t or t.lower().startswith("[silent]"):
        return True
    lines = [line.strip() for line in t.splitlines() if line.strip()]
    return any(c.lower() in SILENT_TOKENS for c in (t, lines[0], lines[-1]))


def extract_answer(archive: str) -> tuple[str, str | None]:
    """("answer", text), ("silent", None) or ("unusable", None) for a missing or truncated frame."""
    prompt_frame = _PROMPT_FRAME_RE.search(archive)
    if prompt_frame is not None and archive.find(_PROMPT_HEADING) == prompt_frame.end() - len(_PROMPT_HEADING):
        response_start = prompt_frame.end() + int(prompt_frame.group(1)) + len(_PROMPT_SEPARATOR)
        frame = _RESPONSE_FRAME_RE.match(archive, response_start)
        tail = archive[frame.end():] if frame is not None else ""
        if (frame is None or len(tail) != int(frame.group(1)) + len(_RESPONSE_TERMINATOR)
                or not tail.endswith(_RESPONSE_TERMINATOR)):
            return "unusable", None
        answer = tail[:-len(_RESPONSE_TERMINATOR)].strip()
    elif "## Response" not in archive:
        answer = archive.strip()
    else:
        answer = archive.rpartition("## Response")[2].strip()
    if not answer or is_silent(answer):
        return "silent", None
    return "answer", answer


_FENCE_RE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\r?\n(.*?)\r?\n?```[ \t]*$", re.S)


def _reject_constant(name: str) -> None:
    raise ValueError(f"{name} is not valid JSON")


def parse_answer(answer: str) -> tuple[dict | None, str | None]:
    """The edition object, or an error message for the alert."""
    text = answer.strip()
    m = _FENCE_RE.match(text)
    if m:
        text = m.group(1).strip()
    try:
        obj = json.loads(text, parse_constant=_reject_constant)
    except ValueError as err:
        start, end = text.find("{"), text.rfind("}")
        obj = None
        if start != -1 and end > start:
            try:
                obj = json.loads(text[start:end + 1], parse_constant=_reject_constant)
            except ValueError:
                obj = None
        if obj is None:
            if not text.startswith(("{", "[")) and start == -1:
                return None, "the answer is not JSON"
            where = f" (line {err.lineno}, column {err.colno})" if isinstance(err, json.JSONDecodeError) else ""
            return None, f"the answer is not valid JSON{where}"
    if not isinstance(obj, dict):
        return None, "the answer is JSON but not an object"
    return obj, None


# ---------------------------------------------------------------------------------------------------------------
# Time


def santiago():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/Santiago")
    except Exception:  # no tz database: Chile's summer offset
        return dt.timezone(dt.timedelta(hours=-3))


def run_time(file: str) -> dt.datetime:
    """The run time encoded in the archive name (Santiago local time), timezone-aware."""
    m = RUN_FILE_RE.match(file)
    if not m:
        raise ValueError(f"not a run file: {file}")
    return dt.datetime(*(int(x) for x in m.groups()), tzinfo=santiago())


def edition_id(feed: str, file: str) -> str:
    m = RUN_FILE_RE.match(file)
    if not m:
        raise ValueError(f"not a run file: {file}")
    y, mo, d, h, mi, s = m.groups()
    return f"{feed}-{y}{mo}{d}-{h}{mi}{s}"


def short_date(d: dt.date) -> str:
    return f"{WEEKDAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}"


def edition_day(edition: dict, file: str) -> dt.date:
    raw = edition.get("edition_date") if isinstance(edition, dict) else None
    if isinstance(raw, str) and DATE_RE.match(raw.strip()):
        try:
            return dt.date(*(int(x) for x in raw.strip().split("-")))
        except ValueError:
            pass
    return run_time(file).date()


# ---------------------------------------------------------------------------------------------------------------
# Messages: plain text (no Markdown Telegram could misparse), each under MAX_MESSAGE characters.

_MARKDOWN_CHARS = str.maketrans({"*": "", "_": " ", "`": "'", "[": "(", "]": ")", "~": "-", "<": "‹", ">": "›"})
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]")


def plain(value, limit: int) -> str:
    text = value if isinstance(value, str) else ""
    text = _CONTROL_RE.sub("", text).translate(_MARKDOWN_CHARS)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit - 1].rstrip() + "…"
    return text


def _stories(edition: dict) -> list[dict]:
    stories = edition.get("stories") if isinstance(edition, dict) else None
    return [s for s in stories if isinstance(s, dict)] if isinstance(stories, list) else []


def _section(story: dict) -> str:
    s = story.get("section")
    return re.sub(r"[\s-]+", "_", s.strip().lower()) if isinstance(s, str) else ""


def _rank(story: dict) -> int:
    r = story.get("rank")
    return r if isinstance(r, int) and not isinstance(r, bool) else 999


def headline_stories(info: dict, edition: dict) -> list[dict]:
    stories = _stories(edition)
    order = info["message_sections"]
    picked = [s for s in stories if _section(s) in order]
    if not picked:
        return stories
    return sorted(picked, key=lambda s: (order.index(_section(s)), _rank(s)))


def fit(lines: list[str], fixed_tail: list[str], optional_from: int) -> str:
    """Join lines, dropping optional lines (from the end) until the message fits."""
    body = list(lines)
    while True:
        text = "\n".join(body + fixed_tail)
        if len(text) < MAX_MESSAGE or len(body) <= optional_from:
            break
        body.pop()
    return text if len(text) < MAX_MESSAGE else text[:MAX_MESSAGE - 1]


def short_message(info: dict, edition: dict, ed_id: str, file: str, public_url: str, fallback: bool = False) -> str:
    head = [f"{info['emoji']} {info['label']} · {short_date(edition_day(edition, file))}"]
    lead = plain(edition.get("lead") if isinstance(edition, dict) else None, 400)
    if lead:
        head.append(lead)
    if info["feed"] == "cyber":
        stories = _stories(edition)
        patch = sum(1 for s in stories if _section(s) == "patch_now")
        stack = sum(1 for s in stories if _section(s) == "your_stack")
        head.append(f"\U0001F6A8 {patch} patch now · ⚠️ {stack} affect your stack")
    picked = headline_stories(info, edition)
    lines = []
    for i, s in enumerate(picked[:MAX_STORY_LINES], 1):
        h = plain(s.get("headline"), 160) or "(untitled)"
        lines.append(f"{i}. {h}{' (update)' if s.get('is_update') is True else ''}")
    if len(picked) > MAX_STORY_LINES:
        lines.append(f"+{len(picked) - MAX_STORY_LINES} more")
    tail = []
    if fallback:
        tail.append("⚠️ reader unavailable, will store later")
    tail.append(f"\U0001F4D6 {public_url}/e/{ed_id}")
    return fit(head + lines, tail, len(head))


def stored_later_message(info: dict, edition: dict, ed_id: str, file: str, public_url: str) -> str:
    return (f"✅ {info['emoji']} {info['label']} · {short_date(edition_day(edition, file))} is in the reader now: "
            f"{public_url}/e/{ed_id}")


def alert_message(info: dict, file: str, what: str, errors: list[str]) -> str:
    detail = "; ".join(plain(e, 300) for e in errors[:3] if isinstance(e, str))
    text = f"⚠️ {info['label']} {short_date(run_time(file).date())} {what}"
    return (text + (f": {detail}" if detail else ""))[:MAX_MESSAGE - 1]


# ---------------------------------------------------------------------------------------------------------------
# Config, state, lock


def load_config(env) -> dict:
    def path(key: str, default: str) -> str:
        return os.path.expanduser(env.get(key) or default)

    return {
        "output": path("HERMES_CRON_OUTPUT", "~/.hermes/cron/output"),
        "state": path("NEWS_PUBLISHER_STATE", "~/.hermes/news-publisher/state.json"),
        "env_file": path("NEWS_ENV_FILE", "~/Projects/homelab/news/.env"),
        "ingest_url": env.get("NEWS_INGEST_URL") or "http://127.0.0.1:8787/ingest/editions",
        "public_url": (env.get("NEWS_PUBLIC_URL") or "https://news.lab.x-muramasa.dev").rstrip("/"),
    }


def read_token(env_file: str) -> str | None:
    try:
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:].lstrip()
                if line.startswith("INGEST_TOKEN="):
                    value = line.split("=", 1)[1].strip()
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                        value = value[1:-1]
                    return value or None
    except OSError:
        return None
    return None


def ensure_private_dir(path: str) -> None:
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def load_state(path: str) -> tuple[dict | None, bool]:
    """(state, corrupt). None when there is no state file yet (first run ever)."""
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
        if isinstance(state, dict) and isinstance(state.get("runs"), dict):
            return state, False
    except FileNotFoundError:
        return None, False
    except (OSError, ValueError):
        pass
    return None, True


def save_state(path: str, state: dict) -> None:
    directory = os.path.dirname(path) or "."
    ensure_private_dir(directory)
    fd, tmp = tempfile.mkstemp(prefix=".state-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=1, sort_keys=True, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    try:
        dfd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass


class Locked(Exception):
    pass


def acquire_lock(state_path: str):
    directory = os.path.dirname(state_path) or "."
    ensure_private_dir(directory)
    fd = os.open(os.path.join(directory, "publisher.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise Locked()
    return fd


def list_runs(output: str) -> list[tuple[str, str, str]]:
    """(job_id, file, path) for every run archive of the three jobs, oldest first."""
    runs = []
    for job_id in FEEDS:
        directory = os.path.join(output, job_id)
        try:
            names = os.listdir(directory)
        except OSError:
            continue
        for name in names:
            p = os.path.join(directory, name)
            if RUN_FILE_RE.match(name) and os.path.isfile(p):
                runs.append((job_id, name, p))
    runs.sort(key=lambda r: (r[1], r[0]))
    return runs


# ---------------------------------------------------------------------------------------------------------------
# HTTP


def post_edition(url: str, token: str, payload: dict) -> tuple[int | None, object, str | None]:
    """(status, parsed JSON body or None, transport error). Never includes the token in errors."""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "news-publisher/1",
    })
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=POST_TIMEOUT) as resp:
            status, raw = resp.status, resp.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as err:
        status = err.code
        try:
            raw = err.read(MAX_RESPONSE_BYTES)
        except (OSError, http.client.HTTPException):
            raw = b""
        finally:
            err.close()
    except urllib.error.URLError as err:
        return None, None, f"connection failed ({type(err.reason).__name__})"
    except (OSError, http.client.HTTPException) as err:
        return None, None, f"connection failed ({type(err).__name__})"
    try:
        body = json.loads(raw.decode("utf-8")) if raw else None
    except ValueError:
        body = None
    return status, body, None


# ---------------------------------------------------------------------------------------------------------------
# One tick


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat(timespec="seconds")


class Tick:
    def __init__(self, cfg: dict, state: dict, now: float):
        self.cfg = cfg
        self.state = state
        self.now = now
        self.started = time.monotonic()
        self.api_down = False
        self.token: str | None = None
        self.token_loaded = False
        self.messages: list[str] = []

    def get_token(self) -> str | None:
        if not self.token_loaded:
            self.token = read_token(self.cfg["env_file"])
            self.token_loaded = True
        return self.token

    def record(self, key: str, entry: dict, **changes) -> None:
        entry.update(changes)
        entry["updated_at"] = _iso(self.now)
        self.state["runs"][key] = entry

    def process(self, job_id: str, file: str, path: str) -> None:
        info = FEEDS[job_id]
        key = f"{job_id}/{file}"
        entry = dict(self.state["runs"].get(key) or {})
        if entry.get("status") in DONE:
            return
        age = self.now - os.path.getmtime(path)
        if not entry and age < SETTLE_SECONDS:
            return  # still being written; next tick
        entry.setdefault("feed", info["feed"])
        entry.setdefault("first_seen", _iso(self.now))

        with open(path, encoding="utf-8", errors="replace", newline="") as f:
            archive = f.read()
        kind, answer = extract_answer(archive)
        if kind == "unusable":
            if age < TRUNCATED_GRACE:
                return
            self.record(key, entry, status="failed", last_error="truncated or unframed run archive")
            self.messages.append(alert_message(info, file, "failed: the run archive has no complete answer", []))
            return
        if kind == "silent":
            self.record(key, entry, status="silent")
            return

        edition, error = parse_answer(answer or "")
        if edition is None:
            self.record(key, entry, status="failed", last_error=error)
            self.messages.append(alert_message(info, file, "failed validation", [error or "unreadable answer"]))
            return

        payload = dict(edition)
        payload["source_run"] = {"job_id": job_id, "file": file}
        payload["generated_at"] = run_time(file).isoformat(timespec="seconds")
        local_id = edition_id(info["feed"], file)

        status, body, transport = None, None, None
        token = self.get_token()
        if token is None:
            transport = "ingest token not found"
        elif self.api_down or time.monotonic() - self.started > RUN_BUDGET:
            transport = "deferred"
        else:
            status, body, transport = post_edition(self.cfg["ingest_url"], token, payload)
        entry["attempts"] = entry.get("attempts", 0) + (0 if transport in ("deferred", "ingest token not found") else 1)

        if status in (200, 201):
            ed_id = body.get("edition_id") if isinstance(body, dict) else None
            if not isinstance(ed_id, str) or not re.fullmatch(r"[a-z]+-\d{8}-\d{6}", ed_id):
                ed_id = local_id
            if entry.get("fallback_sent"):
                self.messages.append(stored_later_message(info, edition, ed_id, file, self.cfg["public_url"]))
            else:
                self.messages.append(short_message(info, edition, ed_id, file, self.cfg["public_url"]))
            self.record(key, entry, status="published", edition_id=ed_id, last_error=None)
            return

        if status in (400, 413, 422):
            errors = body.get("errors") if isinstance(body, dict) else None
            if not isinstance(errors, list) or not errors:
                err = body.get("error") if isinstance(body, dict) else None
                errors = [err if isinstance(err, str) else f"HTTP {status}"]
            self.record(key, entry, status="failed", last_error=f"HTTP {status}")
            self.messages.append(alert_message(info, file, "failed validation", errors))
            return

        # API down, 5xx, auth or other trouble: retry silently on the next tick.
        if (status is not None and status >= 500) or (transport or "").startswith("connection"):
            self.api_down = True  # don't wait on it again this tick
        self.record(key, entry, status="pending", last_error=transport or f"HTTP {status}")
        if not entry.get("fallback_sent") and self.now - run_time(file).timestamp() >= FALLBACK_AFTER:
            self.messages.append(short_message(info, edition, local_id, file, self.cfg["public_url"], fallback=True))
            self.record(key, entry, fallback_sent=True)


def run(cfg: dict, now: float | None = None) -> str:
    """One publisher tick. Returns the text for stdout ("" when there is nothing to say)."""
    now = time.time() if now is None else now
    try:
        lock = acquire_lock(cfg["state"])
    except Locked:
        return ""
    try:
        state, corrupt = load_state(cfg["state"])
        messages = []
        if state is None:
            # First run ever (or unreadable state): mark every existing run as legacy so old Markdown briefings
            # never turn into alerts. Only runs that appear after this are published.
            if corrupt:
                aside = f"{cfg['state']}.corrupt-{int(now)}"
                os.replace(cfg["state"], aside)
                messages.append("⚠️ news publisher: the state file was unreadable; moved it aside and skipped "
                                "the runs already on disk.")
            state = {"version": 1, "initialized_at": _iso(now), "runs": {}}
            for job_id, file, _ in list_runs(cfg["output"]):
                state["runs"][f"{job_id}/{file}"] = {"status": "skipped_legacy", "feed": FEEDS[job_id]["feed"],
                                                     "updated_at": _iso(now)}
            save_state(cfg["state"], state)
            return "\n\n".join(messages)

        tick = Tick(cfg, state, now)
        for job_id, file, path in list_runs(cfg["output"]):
            try:
                tick.process(job_id, file, path)
            except Exception as err:  # one bad run must not block the others
                info = FEEDS[job_id]
                key = f"{job_id}/{file}"
                entry = dict(state["runs"].get(key) or {"feed": info["feed"], "first_seen": _iso(now)})
                tick.record(key, entry, status="failed", last_error=f"{type(err).__name__}: {err}"[:300])
                tick.messages.append(alert_message(info, file, f"could not be published ({type(err).__name__})", []))
        save_state(cfg["state"], state)
        return "\n\n".join(tick.messages)
    finally:
        os.close(lock)


def main(argv=None) -> int:
    cfg = load_config(os.environ)
    try:
        out = run(cfg)
    except Exception as err:
        print(f"news_publisher: {type(err).__name__}: {err}", file=sys.stderr)
        return 1
    if out:
        sys.stdout.buffer.write(out.encode("utf-8") + b"\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
