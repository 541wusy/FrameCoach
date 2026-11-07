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
MAX_CONTEXT_CHARS = 120000

ANALYZE_VERSION = "analyze-v1"
RECIPE_VERSION = "recipe-v4"

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

RECIPE_SYSTEM = """You are a friendly photography coach for a hobbyist. The user shoots photos (their own set) and admires a set of reference photos.
You get: GAPS (plain-language differences between the user's photos and the references, each with a key), descriptions of the reference photos, the user's photos (id, file name, month shot, tags; for large collections this is an even sample over time), the user's GEAR RANGE from EXIF, and TIMELINE (how the user's photos changed over time, or null if the data cannot support it).
Your job: tell the user what to DO while shooting to get the feel of the references. Do not write a report about how their photos differ.
Writing rules:
- Plain everyday English, short sentences, as if talking to a friend. No statistics or jargon. Never write decimals, percentages or words like luminance, saturation share, vertical share, people share. Describe the feel instead (darker and moodier, richer colour, framed by branches).
- "summary": 2-3 sentences. The feeling of the reference photos in simple words, and the main change that would bring the user closer.
- At most 7 items. Each item has:
  - "action": ONE concrete thing to do on the next shoot (where to stand, what to wait for, how to frame, what to look for). Name the situation it applies to, for example "at a lookout on a hazy day". No generic tips like "use the rule of thirds".
  - "why": one plain sentence linking the action to the look of the references.
  - "startingPoint" (optional): a rule-of-thumb value to try first, for example "exposure compensation around -0.7 EV" or "about f/5.6". It is shown to the user as something to try and adjust, not as a measurement. Put ALL numbers about exposure, size or proportion here. Never put numbers in action or why (focal length and aperture from the gear range may appear in action).
- Every action must be something done while shooting. Never suggest editing, filters, presets, post-processing, or changing saturation/vibrance, in editing or in the camera's picture style.
- Refer to the user's photos by file name in action, why and weakness. Put the ids in userPhotoIds.
- Every item must have basis.gapKey (EXACTLY one of the provided gap keys), basis.referenceFeature (something observed in the references), and/or basis.trendKey.
- Every item must cite at least one user photo id in userPhotoIds (ids from the provided list only), the photo the change applies to.
- Reference photos have no EXIF. Any claim about the references' settings, time of day or lighting is a guess: set label "Inferred" and say it is a guess in the action.
- label is "Measured" only if the action rests on a provided gap, "Observed" if it rests on something visible in the references/user photos, else "Inferred".
- Focal lengths/apertures you recommend must lie within the user's gear range. Otherwise set needsNewGear true and say so in the action.
- "progress": ONLY if TIMELINE is not null, otherwise set it to null. It is about the user's OWN change over time, not about the references. Use only the plain sentences in TIMELINE.trends, each identified by its key.
  - "summary": 2-3 plain sentences on how the user's habits and style have changed from the earlier period to the recent one. Use the period labels from TIMELINE.periods (for example "Earlier (2019-04 to 2023-06)").
  - "changes": 2 to 6 notes. Each has "text" (one or two plain sentences), "trendKey" (EXACTLY one key from TIMELINE.trends), "direction" ("closer" or "further" when the trend says so about the references, "steady" if it did not change, otherwise "different"), and optional "examples" (ids of photos from TIMELINE.examples that show the change).
  - Describe what changed. NEVER say the user improved, got better, got worse, or has more or less skill, and never use the words improve, improvement or skill. Photos cannot measure skill.
  - Say what to KEEP doing when a change moves toward the references, and what to watch when a problem still shows up or got more common.
  - No percentages, decimals or fractions in the notes. Months and years are fine.
- Items may also use basis.trendKey (EXACTLY one key from TIMELINE.trends) when the advice follows from the user's own change over time, for example "keep doing what you did in your recent photos".
- Also include one "weakness": a specific, plain-language weakness in the user's photos, citing photo ids.
- Do not output a confidence field; it is decided elsewhere.
Reply with JSON only:
{"summary": string, "progress": null | {"summary": string, "changes": [{"text": string, "trendKey": string, "direction": "closer"|"further"|"steady"|"different", "examples"?: string[]}]},
 "weakness": {"text": string, "photoIds": string[]},
 "items": [{"action": string, "why": string, "startingPoint"?: string, "basis": {"gapKey"?: string, "referenceFeature"?: string, "trendKey"?: string},
            "userPhotoIds": string[], "label": "Measured"|"Observed"|"Inferred", "needsNewGear"?: boolean}]}"""

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
    ctx = json.dumps({k: p.get(k) for k in ("gaps", "references", "userPhotos", "gear", "timeline")})
    if len(ctx) > MAX_CONTEXT_CHARS:  # never cut the JSON silently: a half-sent context gives wrong advice
        raise ValueError(f"Recipe context too large ({len(ctx)} characters). Use fewer reference photos.")
    text = "Context (JSON):\n" + ctx
    if p.get("retryError"):
        text += f"\n\nYour previous reply was rejected: {str(p['retryError'])[:600]}. Fix it."
    out = call_claude(MODEL_STRONG, RECIPE_SYSTEM, [{"type": "text", "text": text}], 9000)
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
