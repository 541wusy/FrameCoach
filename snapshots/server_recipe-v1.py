"""FrameCoach server: serves the static app and proxies two routes to the Anthropic API.

Run:  python server.py     (reads .env in this folder; see .env.example)
The API key lives only here, never in the browser. Request bodies are never logged.
"""
import json, os, re, sys, time, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
WEB = ROOT / "web"


def load_env():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


load_env()
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_FAST = os.environ.get("MODEL_FAST", "claude-haiku-5-5")      # per-photo analysis
MODEL_STRONG = os.environ.get("MODEL_STRONG", "claude-sonnet-5-5")  # recipe writing
PORT = int(os.environ.get("PORT", "8000"))
DAILY_MAX_CALLS = int(os.environ.get("DAILY_MAX_CALLS", "300"))
PER_MIN_PER_IP = int(os.environ.get("PER_MIN_PER_IP", "60"))
MAX_BODY = 4 * 1024 * 1024

ANALYZE_VERSION = "analyze-v1"
RECIPE_VERSION = "recipe-v1"

ANALYZE_SYSTEM = """You describe a single photograph for a photography coaching app. Reply with JSON only, no prose.
Rules:
- Describe only what is visible. NEVER state or guess camera, lens, aperture, shutter speed, ISO or focal length.
- Never identify a person or guess identity, age or personal traits. Only say whether people are present and how they appear.
- List weaknesses only if clearly visible at reduced resolution. Do not comment on focus accuracy or noise.
- If the image is unclear, say so and use confidence "low".
JSON schema:
{"subjects": string[], "composition": string[], "lighting": string, "colorMood": string,
 "people": {"present": boolean, "count": "none"|"one"|"few"|"many", "visibility": "back"|"distant"|"face"|"n/a"},
 "styleTags": string[] (3-6 short lowercase tags), "weaknesses": string[], "confidence": "low"|"medium"|"high"}"""

RECIPE_SYSTEM = """You are a photography coach. The user shoots photos (their own set) and admires a set of reference photos.
You get: measured GAPS computed by code (each has a key), descriptions of the reference photos, the user's photos (id + tags), and the user's GEAR RANGE from EXIF.
Write a shooting recipe: at most 7 items. Each item is ONE concrete action for the next shoot that names a condition (light, location, subject) and a change (framing, exposure compensation, distance, etc). No generic tips like "use the rule of thirds".
Rules:
- Every item must have basis.gapKey (EXACTLY one of the provided gap keys) and/or basis.referenceFeature (something observed in the references).
- Every item must cite at least one user photo id in userPhotoIds (ids from the provided list only), the photo the change applies to.
- Reference photos have no EXIF. Any claim about the references' settings, time of day or lighting is a guess: set label "Inferred" and say why in the action.
- label is "Measured" only if the action rests on a computed gap, "Observed" if it rests on something visible in the references/user photos, else "Inferred".
- Focal lengths/apertures you recommend must lie within the user's gear range. Otherwise set needsNewGear true and say so in the action.
- Also include one short "summary" (2-3 sentences) of the style gap, and one "weakness": a specific weakness in the user's photos citing photo ids.
Reply with JSON only:
{"summary": string, "weakness": {"text": string, "photoIds": string[]},
 "items": [{"action": string, "basis": {"gapKey"?: string, "referenceFeature"?: string},
            "userPhotoIds": string[], "label": "Measured"|"Observed"|"Inferred",
            "confidence": "low"|"medium"|"high", "needsNewGear"?: boolean}]}"""

_ip_hits = {}
_day = {"date": time.strftime("%Y-%m-%d"), "n": 0}


def check_limits(ip):
    today = time.strftime("%Y-%m-%d")
    if _day["date"] != today:
        _day.update(date=today, n=0)
    if _day["n"] >= DAILY_MAX_CALLS:
        return "Daily call cap reached. Try again tomorrow."
    now = time.time()
    hits = [t for t in _ip_hits.get(ip, []) if now - t < 60]
    if len(hits) >= PER_MIN_PER_IP:
        return "Rate limit: too many requests, slow down."
    hits.append(now)
    _ip_hits[ip] = hits
    _day["n"] += 1
    return None


def call_claude(model, system, content, max_tokens):
    body = json.dumps({
        "model": model, "max_tokens": max_tokens, "system": system,
        "messages": [{"role": "user", "content": content}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    stop = data.get("stop_reason")
    if stop == "max_tokens":
        print(f"[debug] {model} hit max_tokens ({max_tokens}); output truncated", file=sys.stderr)
        raise ValueError("Model output was cut off (max_tokens). Try again.")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("Model returned no JSON")
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as e:
        # Debug aid: show raw model text in the server console only (never sent to the browser).
        print(f"[debug] JSON parse failed ({e}); stop_reason={stop}; raw model text follows:\n{text}\n[end raw]", file=sys.stderr)
        raise


def handle_analyze(p):
    img = p.get("imageBase64", "")
    if not img or len(img) > 3_500_000:
        raise ValueError("Missing or oversized image")
    text = "Describe this photo as JSON."
    if p.get("retryError"):
        text += f" Your previous reply was invalid: {str(p['retryError'])[:300]}. Fix it."
    out = call_claude(MODEL_FAST, ANALYZE_SYSTEM, [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}},
        {"type": "text", "text": text}], 1500)
    return {"analysis": out, "version": f"{ANALYZE_VERSION}/{MODEL_FAST}"}


def handle_recipe(p):
    ctx = json.dumps({k: p.get(k) for k in ("gaps", "references", "userPhotos", "gear")})[:60000]
    text = "Context (JSON):\n" + ctx
    if p.get("retryError"):
        text += f"\n\nYour previous reply was rejected: {str(p['retryError'])[:600]}. Fix it."
    out = call_claude(MODEL_STRONG, RECIPE_SYSTEM, [{"type": "text", "text": text}], 6000)
    return {"recipe": out, "version": f"{RECIPE_VERSION}/{MODEL_STRONG}"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):  # never log bodies; keep it quiet
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        routes = {"/api/analyze": handle_analyze, "/api/recipe": handle_recipe}
        fn = routes.get(self.path)
        if not fn:
            return self._json(404, {"error": "Not found"})
        origin = self.headers.get("origin")
        if origin and origin.split("://", 1)[-1] != self.headers.get("host"):
            return self._json(403, {"error": "Cross-origin requests not allowed"})
        if not API_KEY:
            return self._json(500, {"error": "ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key."})
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"error": "Payload too large"})
        err = check_limits(self.client_address[0])
        if err:
            return self._json(429, {"error": err})
        try:
            payload = json.loads(self.rfile.read(n))
            self._json(200, fn(payload))
        except urllib.error.HTTPError as e:
            self._json(502, {"error": f"Model API error {e.code}"})
        except Exception as e:
            self._json(500, {"error": f"{type(e).__name__}: {e}"[:300]})


if __name__ == "__main__":
    if not API_KEY:
        print("WARNING: ANTHROPIC_API_KEY not set (see .env.example)", file=sys.stderr)
    print(f"FrameCoach on http://localhost:{PORT}  models: {MODEL_FAST} / {MODEL_STRONG}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
