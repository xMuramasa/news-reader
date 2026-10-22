"""Tests for publisher/news_publisher.py: temp dirs and a fake ingest API on a random port. No network."""
from __future__ import annotations

import fcntl
import importlib.util
import json
import os
import socket
import stat
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("news_publisher", ROOT / "publisher" / "news_publisher.py")
np = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(np)

ARCHIVES = ROOT / "test" / "fixtures" / "archives"
EDITIONS = ROOT / "test" / "fixtures" / "editions"
CHILE, CYBER, AI = "7a38c16d35fd", "d3a7c91070f7", "7e15c4016256"
TOKEN = "tok-" + "9f" * 20
PUBLIC = "https://news.lab.x-muramasa.dev"


def edition(feed: str) -> dict:
    e = json.loads((EDITIONS / f"{feed}.valid.json").read_text(encoding="utf-8"))
    del e["source_run"], e["generated_at"]  # the publisher adds these
    return e


def framed(response: str, prompt: str = "Write the briefing.") -> str:
    """A run archive exactly as Hermes' writer lays it out."""
    return (
        "# Cron Job: Test job\n\n**Job ID:** x\n**Run Time:** 2026-10-21 08:00:04\n**Schedule:** 0 8 * * *\n\n"
        f"**Prompt Characters:** {len(prompt)}\n## Prompt\n\n{prompt}\n\n"
        f"**Response Characters:** {len(response)}\n## Response\n\n{response}\n"
    )


class FakeAPI:
    """Ingest API stand-in. `replies` is a queue of (status, body); when empty it answers like the real API."""

    def __init__(self):
        self.requests: list[dict] = []
        self.replies: list[tuple[int, object]] = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                payload = json.loads(raw)
                api.requests.append({"path": self.path, "headers": dict(self.headers), "payload": payload})
                if api.replies:
                    status, body = api.replies.pop(0)
                else:
                    sr = payload["source_run"]
                    status = 201
                    body = {"edition_id": np.edition_id(payload["feed"], sr["file"]), "stories": 1, "warnings": []}
                data = json.dumps(body).encode() if not isinstance(body, bytes) else body
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/ingest/editions"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)


def closed_port_url() -> str:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://127.0.0.1:{port}/ingest/editions"


class Env:
    """Temp output dir, state dir and env file."""

    def __init__(self, case: unittest.TestCase, ingest_url: str):
        self.tmp = tempfile.TemporaryDirectory()
        case.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.output = base / "output"
        self.output.mkdir()
        self.state_path = base / "news-publisher" / "state.json"
        self.env_file = base / ".env"
        self.env_file.write_text(f"# news\nMONGO_PASSWORD=x\nINGEST_TOKEN={TOKEN}\n", encoding="utf-8")
        self.cfg = np.load_config({
            "HERMES_CRON_OUTPUT": str(self.output),
            "NEWS_PUBLISHER_STATE": str(self.state_path),
            "NEWS_ENV_FILE": str(self.env_file),
            "NEWS_INGEST_URL": ingest_url,
            "NEWS_PUBLIC_URL": PUBLIC + "/",
        })

    def archive(self, job_id: str, file: str, text: str, written_after_run: float = 60) -> Path:
        d = self.output / job_id
        d.mkdir(exist_ok=True)
        p = d / file
        p.write_text(text, encoding="utf-8", newline="")
        t = np.run_time(file).timestamp() + written_after_run if np.RUN_FILE_RE.match(file) else 1_700_000_000
        os.utime(p, (t, t))
        return p

    def initialize(self):
        """First tick with nothing on disk, so later archives count as new."""
        self.assertEmpty(np.run(self.cfg, now=1_700_000_000))

    @staticmethod
    def assertEmpty(out):
        assert out == "", out

    def state(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def run(self, file: str, minutes_after_run: float = 5) -> str:
        return np.run(self.cfg, now=np.run_time(file).timestamp() + minutes_after_run * 60)


# ---------------------------------------------------------------------------------------------------------------


class ExtractTests(unittest.TestCase):
    def test_framed_real_archives(self):
        for name, start in [
            ("chile-2026-10-21_11-56-06.md", "**🇨🇱 Chile — Wednesday, 21 October 2026**"),
            ("cyber-2026-10-21_13-21-50.md", "**🛡️ Cyber — Wednesday, Oct 21, 2026**"),
            ("ai-2026-10-19_09-03-52.md", "## 🗞️ Weekly AI Digest: Oct 12–19, 2026"),
        ]:
            text = (ARCHIVES / name).read_text(encoding="utf-8")
            kind, answer = np.extract_answer(text)
            self.assertEqual(kind, "answer", name)
            self.assertTrue(answer.startswith(start), name)
            self.assertNotIn("## Prompt", answer)
            self.assertNotIn("Response Characters", answer)

    def test_cyber_archive_prompt_quotes_headings(self):
        # The cyber prompt carries an injected script output full of "## ..." headings; the frame skips them.
        text = (ARCHIVES / "cyber-2026-10-21_13-21-50.md").read_text(encoding="utf-8")
        kind, answer = np.extract_answer(text)
        self.assertEqual(kind, "answer")
        self.assertTrue(answer.rstrip().endswith("some stories may repeat._"))

    def test_quoted_frames_inside_prompt_and_answer(self):
        prompt = "Example:\n**Response Characters:** 3\n## Response\n\nabc\n"
        response = '{"note": "## Response\\n\\n**Response Characters:** 9"}'
        self.assertEqual(np.extract_answer(framed(response, prompt)), ("answer", response))

    def test_legacy_unframed_archive_uses_last_response_heading(self):
        text = (
            "# Cron Job: x\n\n## Prompt\n\nFormat: end with a '## Response' section.\n\n"
            "## Response\n\n{\"schema\": \"news-edition/v1\"}\n"
        )
        self.assertEqual(np.extract_answer(text), ("answer", '{"schema": "news-edition/v1"}'))
        self.assertEqual(np.extract_answer("plain script output\n"), ("answer", "plain script output"))

    def test_truncated_frame_is_unusable(self):
        good = framed('{"schema": "news-edition/v1", "feed": "chile"}')
        self.assertEqual(np.extract_answer(good)[0], "answer")
        self.assertEqual(np.extract_answer(good[:-5]), ("unusable", None))
        self.assertEqual(np.extract_answer(good[:-1]), ("unusable", None))  # missing terminator
        self.assertEqual(np.extract_answer(good + "extra\n"), ("unusable", None))
        no_response = good[: good.index("**Response Characters:**")]
        self.assertEqual(np.extract_answer(no_response), ("unusable", None))
        real = (ARCHIVES / "chile-2026-10-21_11-56-06.md").read_text(encoding="utf-8")
        self.assertEqual(np.extract_answer(real[:-200]), ("unusable", None))

    def test_silent_runs(self):
        for response in ["[SILENT]", "silent", "NO_REPLY", "No Reply", "  [silent]  ", "[SILENT] nothing new today",
                         "[SILENT]\nNothing new.", "Checked everything.\nSILENT", "", "   "]:
            self.assertEqual(np.extract_answer(framed(response))[0], "silent", repr(response))
        for response in ["The silent majority votes", '{"lead": "[SILENT]"}', "NO_REPLY to the minister's letter"]:
            self.assertEqual(np.extract_answer(framed(response))[0], "answer", repr(response))


class ParseTests(unittest.TestCase):
    def test_plain_and_fenced_json(self):
        obj = {"schema": "news-edition/v1", "feed": "ai"}
        for text in [json.dumps(obj), "```json\n" + json.dumps(obj) + "\n```", "```\n" + json.dumps(obj, indent=2) + "\n```",
                     "```JSON \r\n" + json.dumps(obj) + "\r\n```", "Here it is:\n" + json.dumps(obj)]:
            self.assertEqual(np.parse_answer(text), (obj, None), text)

    def test_invalid_json(self):
        obj, err = np.parse_answer('{"schema": "news-edition/v1", "stories": [}')
        self.assertIsNone(obj)
        self.assertTrue(err.startswith("the answer is not valid JSON (line 1"), err)
        self.assertEqual(np.parse_answer("[1, 2]"), (None, "the answer is JSON but not an object"))
        self.assertEqual(np.parse_answer('{"x": NaN}')[0], None)

    def test_markdown_answer(self):
        md = np.extract_answer((ARCHIVES / "chile-2026-10-21_11-56-06.md").read_text(encoding="utf-8"))[1]
        self.assertEqual(np.parse_answer(md), (None, "the answer is not JSON"))


class MessageTests(unittest.TestCase):
    def test_chile_short_message(self):
        info = np.FEEDS[CHILE]
        msg = np.short_message(info, edition("chile"), "chile-20261021-115606", "2026-10-21_11-56-06.md", PUBLIC)
        self.assertEqual(msg, "\n".join([
            "🇨🇱 Chile · Wed 21 Oct",
            "Congress passed Kast's bill to speed up migrant expulsions, and the fallout from the AFP Fondo E losses is "
            "now in the Senate.",
            "1. Faster migrant-expulsion law clears Congress",
            "2. AFP Fondo E: regulator opens cases, Senate sets a session (update)",
            '3. Quiroz: unchecked welfare states "terminan como Francia"',
            "4. Opposition rift: PPD senator Araya removed as Constitution committee chair",
            "5. Storm: Santiago region on red alert, Arauco evacuated over sinkhole",
            "6. Gonzalo Arenas named government spokesman",
            "📖 https://news.lab.x-muramasa.dev/e/chile-20261021-115606",
        ]))

    def test_cyber_short_message_has_the_patch_line(self):
        info = np.FEEDS[CYBER]
        msg = np.short_message(info, edition("cyber"), "cyber-20261021-132150", "2026-10-21_13-21-50.md", PUBLIC)
        lines = msg.split("\n")
        self.assertEqual(lines[0], "🛡️ Cyber · Wed 21 Oct")
        self.assertEqual(lines[2], "🚨 5 patch now · ⚠️ 6 affect your stack")
        self.assertEqual(lines[3], "1. PHP2Shell: emergency patches for two critical PHP core RCE bugs")
        self.assertEqual(lines[9], "7. SafePay ransomware: joint advisory AA26-293A")
        self.assertEqual(lines[10], "+1 more")
        self.assertEqual(lines[-1], "📖 https://news.lab.x-muramasa.dev/e/cyber-20261021-132150")

    def test_ai_and_fallback_message(self):
        info = np.FEEDS[AI]
        msg = np.short_message(info, edition("ai"), "ai-20261019-090352", "2026-10-19_09-03-52.md", PUBLIC, fallback=True)
        lines = msg.split("\n")
        self.assertEqual(lines[0], "🤖 AI · Mon 19 Oct")
        self.assertEqual(lines[2], "1. Meta releases Muse Spark Open, with Apple's help to run it on Macs")
        self.assertEqual(len([line for line in lines if line[:1].isdigit()]), 4)
        self.assertEqual(lines[-2:], ["⚠️ reader unavailable, will store later", "📖 https://news.lab.x-muramasa.dev/e/ai-20261019-090352"])

    def test_plain_text_and_length(self):
        e = edition("chile")
        e["lead"] = "*Bold* _italic_ `code` [link](http://x) <b>" + "x" * 2000
        e["stories"] = [dict(e["stories"][0], slug=f"s{i}", rank=i + 1, headline="**" + "H" * 500 + "**\n[x](y)")
                        for i in range(40)]
        msg = np.short_message(np.FEEDS[CHILE], e, "chile-20261021-115606", "2026-10-21_11-56-06.md", PUBLIC)
        self.assertLess(len(msg), 3500)
        for ch in "*_`[]<>":
            self.assertNotIn(ch, msg.replace(PUBLIC, "").replace("chile-20261021-115606", ""))
        self.assertIn("+33 more", msg)
        self.assertTrue(msg.endswith("/e/chile-20261021-115606"))

    def test_messy_edition_still_gives_a_message(self):
        msg = np.short_message(np.FEEDS[CYBER], {"stories": "nope", "lead": 5}, "cyber-20261021-132150",
                               "2026-10-21_13-21-50.md", PUBLIC, fallback=True)
        self.assertEqual(msg.split("\n")[:2], ["🛡️ Cyber · Wed 21 Oct", "🚨 0 patch now · ⚠️ 0 affect your stack"])

    def test_alert(self):
        msg = np.alert_message(np.FEEDS[CHILE], "2026-10-21_08-00-04.md", "failed validation",
                               ["a: x", "b: *y*", "c: z", "d: not shown"])
        self.assertEqual(msg, "⚠️ Chile 21 Oct failed validation: a: x; b: y; c: z".replace("Chile 21", "Chile Wed 21"))

    def test_generated_at_uses_santiago_offset(self):
        self.assertEqual(np.run_time("2026-10-21_08-00-04.md").isoformat(), "2026-10-21T08:00:04-03:00")
        self.assertEqual(np.edition_id("cyber", "2026-10-21_13-21-50.md"), "cyber-20261021-132150")


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.addCleanup(self.api.stop)
        self.env = Env(self, self.api.url)

    def test_first_run_skips_existing_archives_then_publishes_new_ones(self):
        for name, job in [("chile-2026-10-21_11-56-06.md", CHILE), ("cyber-2026-10-21_13-21-50.md", CYBER),
                          ("ai-2026-10-19_09-03-52.md", AI)]:
            self.env.archive(job, name.split("-", 1)[1], (ARCHIVES / name).read_text(encoding="utf-8"))
        (self.env.output / f"{CHILE}_20261021_115606.txt").write_text("delivery copy")
        self.assertEqual(np.run(self.env.cfg, now=1_800_000_000), "")
        runs = self.env.state()["runs"]
        self.assertEqual(sorted(runs), sorted([f"{AI}/2026-10-19_09-03-52.md", f"{CHILE}/2026-10-21_11-56-06.md",
                                               f"{CYBER}/2026-10-21_13-21-50.md"]))
        self.assertTrue(all(r["status"] == "skipped_legacy" for r in runs.values()))
        self.assertEqual(self.api.requests, [])
        # The old Markdown runs never produce an alert later on.
        self.assertEqual(np.run(self.env.cfg, now=1_800_000_300), "")
        self.assertEqual(self.api.requests, [])

        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"), ensure_ascii=False)))
        out = self.env.run("2026-10-22_08-00-04.md")
        self.assertTrue(out.startswith("🇨🇱 Chile · Wed 21 Oct\n"), out)
        self.assertTrue(out.endswith("📖 https://news.lab.x-muramasa.dev/e/chile-20261022-080004"), out)
        (req,) = self.api.requests
        self.assertEqual(req["headers"]["Authorization"], f"Bearer {TOKEN}")
        self.assertEqual(req["headers"]["Content-Type"], "application/json")
        self.assertEqual(req["payload"]["source_run"], {"job_id": CHILE, "file": "2026-10-22_08-00-04.md"})
        self.assertEqual(req["payload"]["generated_at"], "2026-10-22T08:00:04-03:00")
        self.assertEqual(req["payload"]["stories"], edition("chile")["stories"])
        entry = self.env.state()["runs"][f"{CHILE}/2026-10-22_08-00-04.md"]
        self.assertEqual((entry["status"], entry["edition_id"]), ("published", "chile-20261022-080004"))
        self.assertEqual(self.env.run("2026-10-22_08-00-04.md", 10), "")  # handled once
        self.assertEqual(len(self.api.requests), 1)

    def test_fenced_json_and_ignored_files(self):
        self.env.initialize()
        self.env.archive(AI, "2026-10-26_09-00-12.md", framed("```json\n" + json.dumps(edition("ai")) + "\n```"))
        self.env.archive(AI, "notes.md", "not a run")
        self.env.archive("ffffffffffff", "2026-10-26_09-00-12.md", framed("{}"))
        out = self.env.run("2026-10-26_09-00-12.md")
        self.assertTrue(out.startswith("🤖 AI · Mon 19 Oct"), out)
        self.assertEqual(len(self.api.requests), 1)
        self.assertNotIn("notes.md", json.dumps(self.env.state()))

    def test_messages_for_several_runs_are_separated_by_a_blank_line(self):
        self.env.initialize()
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"))))
        self.env.archive(CYBER, "2026-10-22_08-30-11.md", framed(json.dumps(edition("cyber"))))
        out = self.env.run("2026-10-22_08-30-11.md")
        parts = out.split("\n\n")
        self.assertEqual(len(parts), 2)
        self.assertTrue(parts[0].startswith("🇨🇱 Chile"))
        self.assertTrue(parts[1].startswith("🛡️ Cyber"))
        self.assertTrue(all(len(p) < 3500 for p in parts))

    def test_silent_run_prints_nothing(self):
        self.env.initialize()
        self.env.archive(CYBER, "2026-10-22_08-30-11.md", framed("[SILENT]"))
        self.assertEqual(self.env.run("2026-10-22_08-30-11.md"), "")
        self.assertEqual(self.api.requests, [])
        self.assertEqual(self.env.state()["runs"][f"{CYBER}/2026-10-22_08-30-11.md"]["status"], "silent")

    def test_invalid_json_alerts_once(self):
        self.env.initialize()
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed('{"schema": "news-edition/v1", "stories": [}'))
        out = self.env.run("2026-10-22_08-00-04.md")
        self.assertEqual(out, "⚠️ Chile Thu 22 Oct failed validation: the answer is not valid JSON (line 1, column 43)")
        self.assertEqual(self.env.run("2026-10-22_08-00-04.md", 10), "")
        self.assertEqual(self.api.requests, [])

    def test_failed_or_blocked_job_runs_are_recorded_quietly(self):
        # Hermes writes these when the job itself failed (e.g. a rate limit) and sends its own alert.
        failed = (
            "# Cron Job: Daily Chile news feed (FAILED)\n\n**Job ID:** x\n**Run Time:** 2026-10-22 08:00:50\n"
            "**Schedule:** 0 8 * * *\n\n## Prompt\n\nWrite the briefing.\n\n## Error\n\n```\n"
            "RuntimeError: HTTP 429: rate limited\n```\n"
        )
        blocked = (
            "# Cron Job: Daily cyber news feed\n\n**Job ID:** x\n**Run Time:** 2026-10-22 08:30:50\n"
            "**Status:** BLOCKED\n\nThe assembled prompt tripped the cron injection scanner.\n"
        )
        self.assertEqual(np.extract_answer(failed), ("job_failed", None))
        self.assertEqual(np.extract_answer(blocked), ("job_failed", None))
        # A real answer that merely mentions "## Error" in its text is still an answer.
        self.assertEqual(np.extract_answer(framed("x\n## Error\n"))[0], "answer")

        self.env.initialize()
        self.env.archive(CHILE, "2026-10-22_08-00-50.md", failed)
        self.env.archive(CYBER, "2026-10-22_08-30-50.md", blocked)
        self.assertEqual(self.env.run("2026-10-22_08-30-50.md"), "")
        runs = self.env.state()["runs"]
        self.assertEqual(runs[f"{CHILE}/2026-10-22_08-00-50.md"]["status"], "job_failed")
        self.assertEqual(runs[f"{CYBER}/2026-10-22_08-30-50.md"]["status"], "job_failed")
        self.assertEqual(self.env.run("2026-10-22_08-30-50.md", 10), "")
        self.assertEqual(self.api.requests, [])

    def test_markdown_answer_alerts_once(self):
        self.env.initialize()
        text = (ARCHIVES / "chile-2026-10-21_11-56-06.md").read_text(encoding="utf-8")
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", text)
        self.assertEqual(self.env.run("2026-10-22_08-00-04.md"), "⚠️ Chile Thu 22 Oct failed validation: the answer is not JSON")
        self.assertEqual(self.env.run("2026-10-22_08-00-04.md", 10), "")

    def test_422_alerts_once_with_the_first_three_errors(self):
        self.env.initialize()
        self.api.replies.append((422, {"errors": ["stories[0].headline: is required", "stories[1].section: must be one of: top",
                                                  "stories[2].sources[0].url: must be an absolute http(s) URL",
                                                  "stories[3].rank: must be number"], "warnings": []}))
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"))))
        out = self.env.run("2026-10-22_08-00-04.md")
        # brackets become parentheses so Telegram can't read them as link syntax
        self.assertEqual(out, "⚠️ Chile Thu 22 Oct failed validation: stories(0).headline: is required; "
                              "stories(1).section: must be one of: top; stories(2).sources(0).url: must be an absolute "
                              "http(s) URL")
        self.assertEqual(self.env.state()["runs"][f"{CHILE}/2026-10-22_08-00-04.md"]["status"], "failed")
        for minutes in (10, 200, 3000):
            self.assertEqual(self.env.run("2026-10-22_08-00-04.md", minutes), "")
        self.assertEqual(len(self.api.requests), 1)
        self.assertTrue((self.env.output / CHILE / "2026-10-22_08-00-04.md").exists())  # left for inspection

    def test_api_down_then_fallback_then_success(self):
        self.env.initialize()
        self.env.cfg["ingest_url"] = closed_port_url()
        f = "2026-10-22_08-30-11.md"
        self.env.archive(CYBER, f, framed(json.dumps(edition("cyber"))))
        self.assertEqual(self.env.run(f, 5), "")
        self.assertEqual(self.env.run(f, 60), "")
        entry = self.env.state()["runs"][f"{CYBER}/{f}"]
        self.assertEqual((entry["status"], entry["attempts"]), ("pending", 2))
        self.assertIn("connection failed", entry["last_error"])

        out = self.env.run(f, 121)
        lines = out.split("\n")
        self.assertEqual(lines[0], "🛡️ Cyber · Wed 21 Oct")
        self.assertEqual(lines[-2:], ["⚠️ reader unavailable, will store later",
                                      "📖 https://news.lab.x-muramasa.dev/e/cyber-20261022-083011"])
        self.assertEqual(self.env.run(f, 126), "")  # fallback only once, still retrying
        self.assertEqual(self.env.state()["runs"][f"{CYBER}/{f}"]["attempts"], 4)

        self.env.cfg["ingest_url"] = self.api.url
        out = self.env.run(f, 131)
        self.assertEqual(out, "✅ 🛡️ Cyber · Wed 21 Oct is in the reader now: "
                              "https://news.lab.x-muramasa.dev/e/cyber-20261022-083011")
        self.assertEqual(self.env.state()["runs"][f"{CYBER}/{f}"]["status"], "published")
        self.assertEqual(self.env.run(f, 136), "")

    def test_5xx_and_auth_errors_retry_silently_and_stop_hammering(self):
        self.env.initialize()
        for f in ("2026-10-22_08-00-04.md", "2026-10-22_08-01-04.md", "2026-10-22_08-02-04.md"):
            self.env.archive(CHILE, f, framed(json.dumps(edition("chile"))))
        last = "2026-10-22_08-02-04.md"
        self.api.replies.append((503, {"error": "unavailable"}))
        self.assertEqual(self.env.run(last, 5), "")
        self.assertEqual(len(self.api.requests), 1)  # API down: the other runs wait for the next tick
        self.api.replies.append((401, {"error": "unauthorized"}))
        out = self.env.run(last, 10)
        self.assertEqual(out.count("📖"), 2)  # 401 retries silently; the two others went through
        self.assertEqual(self.env.state()["runs"][f"{CHILE}/2026-10-22_08-00-04.md"]["status"], "pending")
        out = self.env.run(last, 15)
        self.assertIn("chile-20261022-080004", out)
        self.assertEqual(len(self.api.requests), 5)

    def test_missing_token_is_retried_and_never_printed(self):
        self.env.initialize()
        self.env.env_file.write_text("OTHER=1\n", encoding="utf-8")
        f = "2026-10-22_08-00-04.md"
        self.env.archive(CHILE, f, framed(json.dumps(edition("chile"))))
        self.assertEqual(self.env.run(f), "")
        self.assertEqual(self.env.state()["runs"][f"{CHILE}/{f}"]["last_error"], "ingest token not found")
        self.env.env_file.write_text(f'export INGEST_TOKEN="{TOKEN}"\n', encoding="utf-8")
        out = self.env.run(f, 10)
        self.assertIn("📖", out)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(TOKEN, self.env.state_path.read_text(encoding="utf-8"))

    def test_truncated_archive_waits_then_alerts_once(self):
        self.env.initialize()
        f = "2026-10-22_08-00-04.md"
        self.env.archive(CHILE, f, framed(json.dumps(edition("chile")))[:-50])
        self.assertEqual(self.env.run(f, 5), "")  # maybe still being written
        self.assertNotIn(f"{CHILE}/{f}", self.env.state()["runs"])
        out = self.env.run(f, 30)
        self.assertEqual(out, "⚠️ Chile Thu 22 Oct failed: the run archive has no complete answer")
        self.assertEqual(self.env.run(f, 35), "")
        self.assertEqual(self.api.requests, [])

    def test_fresh_archive_is_left_for_the_next_tick(self):
        self.env.initialize()
        f = "2026-10-22_08-00-04.md"
        self.env.archive(CHILE, f, framed(json.dumps(edition("chile"))), written_after_run=290)
        self.assertEqual(self.env.run(f, 5), "")  # written 10 s ago
        self.assertEqual(self.api.requests, [])
        self.assertIn("📖", self.env.run(f, 6))

    def test_lock_prevents_overlapping_ticks(self):
        self.env.initialize()
        f = "2026-10-22_08-00-04.md"
        self.env.archive(CHILE, f, framed(json.dumps(edition("chile"))))
        fd = os.open(self.env.state_path.parent / "publisher.lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.env.run(f), "")
            self.assertEqual(self.api.requests, [])
            self.assertNotIn(f"{CHILE}/{f}", self.env.state()["runs"])
        finally:
            os.close(fd)
        self.assertIn("📖", self.env.run(f))
        self.assertEqual(len(self.api.requests), 1)

    def test_state_is_private_and_written_atomically(self):
        self.env.initialize()
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"))))
        self.env.run("2026-10-22_08-00-04.md")
        self.assertEqual(stat.S_IMODE(os.stat(self.env.state_path).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.env.state_path.parent).st_mode), 0o700)
        leftovers = [p.name for p in self.env.state_path.parent.iterdir() if p.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    def test_corrupt_state_is_moved_aside_with_one_alert(self):
        self.env.initialize()
        self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"))))
        self.env.state_path.write_text("{not json", encoding="utf-8")
        out = self.env.run("2026-10-22_08-00-04.md")
        self.assertTrue(out.startswith("⚠️ news publisher: the state file was unreadable"), out)
        self.assertEqual(self.env.state()["runs"][f"{CHILE}/2026-10-22_08-00-04.md"]["status"], "skipped_legacy")
        self.assertEqual(len(list(self.env.state_path.parent.glob("state.json.corrupt-*"))), 1)
        self.assertEqual(self.env.run("2026-10-22_08-00-04.md", 10), "")

    def test_one_broken_run_does_not_block_the_others(self):
        self.env.initialize()
        bad = self.env.archive(CHILE, "2026-10-22_08-00-04.md", framed(json.dumps(edition("chile"))))
        self.env.archive(CYBER, "2026-10-22_08-30-11.md", framed(json.dumps(edition("cyber"))))
        bad.chmod(0)
        self.addCleanup(bad.chmod, 0o600)
        if os.access(bad, os.R_OK):
            self.skipTest("running as root: file permissions are not enforced")
        out = self.env.run("2026-10-22_08-30-11.md")
        alert, msg = out.split("\n\n")
        self.assertEqual(alert, "⚠️ Chile Thu 22 Oct could not be published (PermissionError)")
        self.assertTrue(msg.startswith("🛡️ Cyber"))


class ConsistencyTests(unittest.TestCase):
    def test_feed_map_matches_the_schema_fixtures(self):
        for job_id, info in np.FEEDS.items():
            e = json.loads((EDITIONS / f"{info['feed']}.valid.json").read_text(encoding="utf-8"))
            self.assertEqual(e["source_run"]["job_id"], job_id)

    def test_main_prints_utf8_and_nothing_when_idle(self):
        import subprocess
        import sys

        with tempfile.TemporaryDirectory() as tmp:
            env = {"PATH": os.environ.get("PATH", ""), "HOME": tmp, "LANG": "C", "LC_ALL": "C",
                   "HERMES_CRON_OUTPUT": os.path.join(tmp, "out"), "NEWS_PUBLISHER_STATE": os.path.join(tmp, "s", "state.json"),
                   "NEWS_ENV_FILE": os.path.join(tmp, ".env"), "NEWS_INGEST_URL": closed_port_url()}
            p = subprocess.run([sys.executable, "-I", str(ROOT / "publisher" / "news_publisher.py")], env=env,
                               capture_output=True, timeout=30)
            self.assertEqual((p.returncode, p.stdout, p.stderr), (0, b"", b""))
            state = Path(tmp, "s", "state.json")
            state.write_text("{bad", encoding="utf-8")
            p = subprocess.run([sys.executable, "-I", str(ROOT / "publisher" / "news_publisher.py")], env=env,
                               capture_output=True, timeout=30)
            self.assertEqual(p.returncode, 0)
            self.assertTrue(p.stdout.decode("utf-8").startswith("⚠️ news publisher"))


if __name__ == "__main__":
    unittest.main()
