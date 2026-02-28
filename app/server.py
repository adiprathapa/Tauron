#!/usr/bin/env python3
"""
Serve the Tauron frontend as a static site on http://localhost:3000

Usage:
    python app/server.py
"""
import http.server
import os
import socketserver

PORT = 3000

# Serve from the app/ directory (this file's parent)
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class _Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress noisy per-request logs; keep errors
        if args and str(args[1]) not in ('200', '304'):
            super().log_message(fmt, *args)


with socketserver.TCPServer(("", PORT), _Handler) as httpd:
    print(f"Tauron frontend  →  http://localhost:{PORT}")
    print("Keep this running and open the URL above in your browser.")
    print("Backend must also be running: uvicorn backend.main:app --reload")
    httpd.serve_forever()
