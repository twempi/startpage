import importlib.util
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("settings_api", ROOT / "settings-api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class SettingsAPITest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        api.SETTINGS_FILE = Path(self.directory.name) / "settings.json"
        api.SETTINGS_FILE.write_bytes((ROOT / "settings.default.json").read_bytes())
        self.server = api.ThreadingHTTPServer(("127.0.0.1", 0), api.SettingsHandler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)

    def request(self, method, payload=None, path="/api/settings", headers=None):
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=json.dumps(payload) if payload is not None else None,
                               headers=headers or {"Content-Type": "application/json"})
            response = connection.getresponse()
            body = response.read()
            return response.status, json.loads(body) if body else None, dict(response.getheaders())
        finally:
            connection.close()

    def test_read_save_and_stale_tab(self):
        status, settings, headers = self.request("GET")
        self.assertEqual(status, 200)
        self.assertEqual(len(settings["_revision"]), 64)
        self.assertIn("no-store", headers["Cache-Control"])
        old_settings = dict(settings)
        settings["username"] = "desktop"
        status, saved, _ = self.request("PUT", settings)
        self.assertEqual(status, 200)
        self.assertNotEqual(saved["settings"]["_revision"], settings["_revision"])
        self.assertNotIn("_revision", json.loads(api.SETTINGS_FILE.read_text()))

        old_settings["weatherLocation"] = "G14 City"
        status, conflict, _ = self.request("PUT", old_settings)
        self.assertEqual(status, 409)
        self.assertIn("Reload", conflict["error"])
        self.assertEqual(self.request("GET")[1], saved["settings"])

    def test_concurrent_saves_only_accept_one(self):
        settings = self.request("GET")[1]
        barrier = threading.Barrier(2)

        def save(name):
            barrier.wait()
            return self.request("PUT", {**settings, "username": name})

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, ["desktop", "g14"]))
        self.assertEqual(sorted(result[0] for result in results), [200, 409])
        winner = next(result[1]["settings"] for result in results if result[0] == 200)
        self.assertEqual(self.request("GET")[1], winner)

    def test_legacy_client_and_invalid_payload_cannot_write(self):
        before = api.SETTINGS_FILE.read_bytes()
        settings = self.request("GET")[1]
        del settings["_revision"]
        self.assertEqual(self.request("PUT", settings)[0], 428)
        settings["_revision"] = "a" * 64
        settings["bookmarks"] = []
        self.assertEqual(self.request("PUT", settings)[0], 400)
        self.assertEqual(api.SETTINGS_FILE.read_bytes(), before)

    def test_external_file_edit_invalidates_revision(self):
        settings = self.request("GET")[1]
        api.SETTINGS_FILE.write_text(json.dumps({**settings, "username": "external edit"}))
        self.assertEqual(self.request("PUT", settings)[0], 409)
        self.assertEqual(self.request("GET")[1]["username"], "external edit")

    def test_routes_and_extension_cors(self):
        origin = "chrome-extension://" + "a" * 32
        status, settings, headers = self.request("GET", headers={"Origin": origin})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        status, _, headers = self.request("OPTIONS", headers={"Origin": origin})
        self.assertEqual(status, 204)
        self.assertIn("GET", headers["Access-Control-Allow-Methods"])
        self.assertEqual(self.request("PUT", settings, headers={
            "Origin": "https://untrusted.example", "Content-Type": "application/json"
        })[0], 403)
        self.assertEqual(self.request("GET", path="/missing")[0], 404)

    def test_unreadable_settings_fail_closed(self):
        api.SETTINGS_FILE.write_text("invalid json")
        self.assertEqual(self.request("GET")[0], 503)
        self.assertEqual(api.SETTINGS_FILE.read_text(), "invalid json")


if __name__ == "__main__":
    unittest.main()
