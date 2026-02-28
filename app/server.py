"""
app/server.py
-------------
Launch the Tauron backend + frontend from a single process.

The FastAPI app (backend/main.py) serves both:
  - API routes:  /herd  /explain/{cow_id}  /api/ingest
  - Frontend:    everything else → app/index.html (StaticFiles mount)

Usage (from repo root):
    python app/server.py              # production-style, port 8000
    python app/server.py --dev        # auto-reload on file changes
    uvicorn backend.main:app --reload # equivalent dev command
"""

import argparse
import sys

try:
    import uvicorn
except ImportError:
    print("uvicorn not found — run: pip install uvicorn[standard]", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tauron server")
    parser.add_argument("--dev", action="store_true", help="enable auto-reload")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    print(f"Starting Tauron on http://{args.host}:{args.port}")
    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        reload=args.dev,
    )
