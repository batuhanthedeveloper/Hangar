#!/usr/bin/env python3
"""Static server for the test harness that also accepts a POST of the
generated ZIP, so the archive can be verified with the system unzip."""

import base64
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DROP = ROOT / "test" / "out"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        DROP.mkdir(parents=True, exist_ok=True)
        target = DROP / "harness.zip"
        target.write_bytes(base64.b64decode(body))
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        # Without this the browser serves a stale panel.css or panel.js from
        # cache after an edit, which is indistinguishable from the change not
        # working.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
