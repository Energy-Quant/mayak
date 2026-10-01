#!/usr/bin/env python3
"""Unit tests for pantheon_state.py MCP tools (stdlib unittest, no pytest).

Uses a THROWAWAY SQLite database (PANTHEON_DB env is set before import), so the
production pantheon.db is never touched. The module log path is redirected to
the same temp directory for the same reason.

Run:  python3 plugin/mcp/test_pantheon_state.py
"""
import json
import os
import sys
import tempfile
import unittest

# ── fixture: temp DB + temp log BEFORE importing the module (DB_PATH is read at import) ──
_TMP_DIR = tempfile.mkdtemp(prefix="pantheon-mcp-test-")
os.environ["PANTHEON_DB"] = os.path.join(_TMP_DIR, "pantheon-test.db")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pantheon_state  # noqa: E402

pantheon_state._LOG_PATH = os.path.join(_TMP_DIR, "test-guard.log")  # keep prod log clean

VALID_SPEC = {
    "title": "Test interview",
    "session_id": "test-session-1",
    "questions": [
        {
            "question": "Which role should plan the release?",
            "options": [
                {"label": "oracle", "description": "Architecture consultation"},
                {"label": "metis", "description": "Critique first"},
            ],
        },
        {
            "question": "Pick any extra flags",
            "multiple": True,
            "options": [{"label": "fast"}],
        },
    ],
}


def call_tool(name, arguments):
    """Invoke a tool through the JSON-RPC handle() path — mirrors a real MCP call."""
    resp = pantheon_state.handle({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    })
    return resp["result"]


def payload(result):
    """Decode the text payload of a successful tool result."""
    return json.loads(result["content"][0]["text"])


def is_error(result):
    return bool(result.get("isError"))


class InterviewCreateTest(unittest.TestCase):
    def test_valid_spec_returns_ok_and_id(self):
        result = call_tool("pantheon_interview", dict(VALID_SPEC))
        self.assertFalse(is_error(result), result)
        data = payload(result)
        self.assertIs(data["ok"], True)
        self.assertIsInstance(data["interview_id"], int)
        self.assertGreater(data["interview_id"], 0)

    def test_valid_spec_persists_pending_row(self):
        result = call_tool("pantheon_interview", dict(VALID_SPEC))
        iid = payload(result)["interview_id"]
        conn = pantheon_state.db()
        row = conn.execute(
            "SELECT status, spec_json, session_id FROM interviews WHERE id=?",
            (iid,),
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["session_id"], "test-session-1")
        spec = json.loads(row["spec_json"])
        self.assertEqual(len(spec["questions"]), 2)
        self.assertEqual(spec["title"], "Test interview")

    def test_missing_questions_is_error(self):
        result = call_tool("pantheon_interview", {"title": "No questions"})
        self.assertTrue(is_error(result), result)

    def test_empty_questions_is_error(self):
        result = call_tool("pantheon_interview", {"questions": []})
        self.assertTrue(is_error(result), result)

    def test_question_without_options_is_error(self):
        spec = {"questions": [{"question": "Pick something"}]}
        result = call_tool("pantheon_interview", spec)
        self.assertTrue(is_error(result), result)

    def test_empty_option_label_is_error(self):
        spec = {
            "questions": [
                {"question": "Q?", "options": [{"label": "   "}]},
            ]
        }
        result = call_tool("pantheon_interview", spec)
        self.assertTrue(is_error(result), result)


class InterviewSubmitTest(unittest.TestCase):
    def _create(self):
        result = call_tool("pantheon_interview", dict(VALID_SPEC))
        return payload(result)["interview_id"]

    def test_submit_marks_done(self):
        iid = self._create()
        result = call_tool(
            "pantheon_interview_submit",
            {"interview_id": iid, "answers_text": "1. oracle\n2. fast"},
        )
        self.assertFalse(is_error(result), result)
        data = payload(result)
        self.assertIs(data["ok"], True)
        self.assertEqual(data["status"], "done")
        conn = pantheon_state.db()
        row = conn.execute(
            "SELECT status, answers_json FROM interviews WHERE id=?", (iid,)
        ).fetchone()
        conn.close()
        self.assertEqual(row["status"], "done")
        self.assertIn("oracle", row["answers_json"])

    def test_submit_missing_id_is_error(self):
        result = call_tool(
            "pantheon_interview_submit",
            {"interview_id": 999999, "answers_text": "x"},
        )
        self.assertTrue(is_error(result), result)

    def test_submit_empty_answers_is_error(self):
        iid = self._create()
        result = call_tool(
            "pantheon_interview_submit",
            {"interview_id": iid, "answers_text": "   "},
        )
        self.assertTrue(is_error(result), result)


class LegacyToolsTest(unittest.TestCase):
    """Long-running tools must keep working (no regressions from interview work)."""

    def test_get_state_does_not_fail(self):
        result = call_tool("pantheon_get_state", {})
        self.assertFalse(is_error(result), result)
        data = payload(result)
        self.assertIn("recent_runs", data)
        self.assertIn("plans", data)
        self.assertIn("kv", data)

    def test_kv_set_get_roundtrip(self):
        result = call_tool(
            "pantheon_kv_set", {"key": "test:mcp:key", "value": "test-value"}
        )
        self.assertFalse(is_error(result), result)
        self.assertIs(payload(result)["ok"], True)

        result = call_tool("pantheon_kv_get", {"key": "test:mcp:key"})
        self.assertFalse(is_error(result), result)
        data = payload(result)
        self.assertEqual(data["key"], "test:mcp:key")
        self.assertEqual(data["value"], "test-value")

    def test_kv_get_missing_key_is_null(self):
        result = call_tool("pantheon_kv_get", {"key": "test:missing:key"})
        self.assertFalse(is_error(result), result)
        self.assertIsNone(payload(result)["value"])

    def test_register_run_and_list_artifacts(self):
        result = call_tool(
            "pantheon_register_run",
            {"session_id": "test-session-1", "role": "oracle", "task_summary": "ci"},
        )
        self.assertFalse(is_error(result), result)

        result = call_tool(
            "pantheon_upsert_artifact",
            {"path": "/tmp/test-plan.md", "kind": "plan", "topic": "ci"},
        )
        self.assertFalse(is_error(result), result)
        self.assertIsNotNone(payload(result)["artifact_id"])

        result = call_tool("pantheon_list_artifacts", {"kind": "plan"})
        self.assertFalse(is_error(result), result)
        self.assertTrue(
            any(a["path"] == "/tmp/test-plan.md" for a in payload(result)["artifacts"])
        )

    def test_tools_list_contains_interview_tools(self):
        resp = pantheon_state.handle({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
        })
        names = [t["name"] for t in resp["result"]["tools"]]
        self.assertIn("pantheon_interview", names)
        self.assertIn("pantheon_interview_submit", names)
        self.assertIn("pantheon_get_state", names)
        self.assertIn("pantheon_kv_get", names)


class ValidateSpecUnitTest(unittest.TestCase):
    """Direct unit tests for the spec validator (raises ValueError on bad input)."""

    def test_valid_spec_normalized(self):
        spec = pantheon_state._validate_interview_spec(dict(VALID_SPEC))
        self.assertEqual(spec["title"], "Test interview")
        self.assertEqual(len(spec["questions"]), 2)
        q0 = spec["questions"][0]
        self.assertEqual(q0["options"][0]["label"], "oracle")
        self.assertIn("description", q0["options"][0])
        # defaults are materialized
        self.assertIs(q0["multiple"], False)
        self.assertIs(q0["allowCustom"], True)

    def test_non_dict_question_rejected(self):
        with self.assertRaises(ValueError):
            pantheon_state._validate_interview_spec({"questions": ["just a string"]})

    def test_empty_question_text_rejected(self):
        with self.assertRaises(ValueError):
            pantheon_state._validate_interview_spec(
                {"questions": [{"question": "  ", "options": [{"label": "a"}]}]}
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
