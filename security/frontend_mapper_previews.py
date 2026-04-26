#!/usr/bin/env python3
"""
Passive public-resource verifier for https://fatins.web.app.

Purpose:
- Fetch only public resources with simple GET requests.
- Verify whether probe files and sourcemaps are actually retrievable.
- Print and save the first N text lines for probe files and sourcemaps.
- Help distinguish:
  - real public file
  - SPA fallback HTML
  - forbidden/missing file
  - readable sourcemap with or without sourcesContent

Default run:
    python3 frontend_mapper_fatins_previews.py

Outputs:
    fatins_public_resource_check/report.md
    fatins_public_resource_check/report.json
    fatins_public_resource_check/files/
    fatins_public_resource_check/reconstructed_sources/
"""

import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.request import Request, urlopen


# =========================
# DEFAULT PARAMETERS
# =========================

DEFAULT_TARGET = "https://fatins.web.app"
DEFAULT_OUTPUT_DIR = "fatins_public_resource_check"
DEFAULT_PREVIEW_LINES = 10
DEFAULT_PROBE_COMMON = True
DEFAULT_ALLOW_CROSS_ORIGIN_ASSETS = False
DEFAULT_TIMEOUT_SECONDS = 12
DEFAULT_DELAY_SECONDS = 0.15
DEFAULT_MAX_FILES = 180
DEFAULT_MAX_BYTES_PER_FILE = 8_000_000
DEFAULT_USER_AGENT = "authorized-passive-public-resource-verifier/1.0"


COMMON_PROBES = [
    "/robots.txt",
    "/sitemap.xml",
    "/security.txt",
    "/.well-known/security.txt",
    "/manifest.json",
    "/site.webmanifest",
    "/asset-manifest.json",
    "/service-worker.js",
    "/sw.js",
    "/firebase-messaging-sw.js",
    "/__/firebase/init.js",
    "/version.json",
    "/config.json",
    "/runtime-config.json",
    "/env.js",
    "/env-config.js",
    "/config.js",
    "/settings.js",
    "/settings.json",
    "/.well-known/assetlinks.json",
    "/.well-known/apple-app-site-association",

    # Exposure checks: still only simple public GET requests.
    "/.env",
    "/.env.production",
    "/firebase.json",
    "/.firebaserc",
    "/.git/HEAD",
    "/.git/config",
    "/.DS_Store",
]

SECRET_PATTERNS = [
    ("critical_private_key", "critical", r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    ("critical_google_service_account", "critical", r'"type"\s*:\s*"service_account"|client_email"\s*:\s*"[^"]+@[^"]+\.iam\.gserviceaccount\.com"'),
    ("critical_aws_access_key", "critical", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("critical_stripe_secret", "critical", r"\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b"),
    ("critical_sendgrid_key", "critical", r"\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b"),
    ("critical_slack_token", "critical", r"\bxox[baprs]-[0-9A-Za-z\-]{20,}\b"),
    ("critical_github_token", "critical", r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
    ("critical_openai_like_key", "critical", r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{24,}\b"),
    ("high_google_api_key", "high_review", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    ("high_jwt_token", "high_review", r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
    ("info_stripe_publishable", "info", r"\bpk_(?:live|test)_[0-9A-Za-z]{16,}\b"),
    ("info_firebase_database", "info", r"\b[a-z0-9\-]+\.firebaseio\.com\b"),
]

FIREBASE_KEYS = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
    "measurementId",
]

ABS_URL_RE = re.compile(r"https?://[^\s'\"<>\\)]+")
SOURCEMAP_RE = re.compile(r"sourceMappingURL=([^\s*]+)")


class AssetParser(HTMLParser):
    def __init__(self, base_url):
        super().__init__()
        self.base_url = base_url
        self.assets = set()

    def handle_starttag(self, tag, attrs):
        attrs = {k.lower(): v for k, v in attrs if k and v}

        if tag == "script" and attrs.get("src"):
            self.assets.add(resolve(self.base_url, attrs["src"]))

        if tag == "link" and attrs.get("href"):
            rel = attrs.get("rel", "").lower()
            href = attrs["href"]
            if any(x in rel for x in ["stylesheet", "preload", "modulepreload", "manifest"]):
                self.assets.add(resolve(self.base_url, href))


def resolve(base, href):
    return urldefrag(urljoin(base, href))[0]


def origin(url):
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def same_origin(a, b):
    return origin(a) == origin(b)


def safe_name(url):
    p = urlparse(url)
    raw = (p.netloc + p.path + ("_" + p.query if p.query else "")).strip("/")
    raw = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
    if not raw:
        raw = "root"
    h = hashlib.sha256(url.encode()).hexdigest()[:10]
    return f"{raw[:120]}__{h}"


def redact(value):
    value = str(value)
    if len(value) <= 12:
        return value[:2] + "..." if len(value) > 4 else "***"
    return value[:6] + "..." + value[-4:]


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def looks_binary(data):
    if not data:
        return False
    return b"\x00" in data[:2048]


def decode_text(data):
    for enc in ["utf-8", "utf-8-sig", "latin-1"]:
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace")


def preview_lines(data, max_lines):
    if not data:
        return []

    if looks_binary(data):
        return ["<binary content omitted>"]

    text = decode_text(data)
    lines = text.splitlines()

    if not lines and text:
        return [text[:500]]

    return lines[:max_lines]


def should_fetch_asset(url):
    path = urlparse(url).path.lower()
    blocked_ext = (
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
        ".ttf", ".otf", ".mp4", ".webm", ".mov", ".pdf", ".zip", ".gz", ".br"
    )
    return not path.endswith(blocked_ext)


def classify_response(url, reason, status, content_type, data):
    path = urlparse(url).path

    if status is None:
        return "network_error"

    if status in [401, 403]:
        return "exists_or_route_blocked_but_not_readable"

    if status == 404:
        return "not_found"

    if status >= 500:
        return "server_error"

    if not (200 <= status < 300):
        return "non_success_status"

    if not data:
        return "empty_success_response"

    if looks_binary(data):
        return "readable_binary"

    text = decode_text(data).lstrip().lower()
    content_type = (content_type or "").lower()

    # Firebase/SPA hosting often returns index.html for unknown paths with 200.
    # This is not proof that the requested file exists.
    if reason == "probe" and (
        "<!doctype html" in text[:300]
        or "<html" in text[:300]
    ):
        suspicious_file_ext = Path(path).suffix.lower()
        if suspicious_file_ext not in [".html", ".htm", ""]:
            return "probably_spa_fallback_html_not_real_file"
        return "readable_html"

    if path.endswith(".map") or reason.startswith("sourcemap"):
        try:
            obj = json.loads(decode_text(data))
            if isinstance(obj, dict) and obj.get("version") and obj.get("sources") is not None:
                if obj.get("sourcesContent"):
                    return "readable_sourcemap_with_sourcesContent"
                return "readable_sourcemap_without_sourcesContent"
        except Exception:
            pass
        return "sourcemap_url_readable_but_not_valid_sourcemap"

    return "readable_text"


def fetch(url, timeout, max_bytes, user_agent):
    req = Request(url, headers={"User-Agent": user_agent})
    try:
        with urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            headers = dict(resp.headers)
            chunks = []
            total = 0
            truncated = False

            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break

                total += len(chunk)

                if total > max_bytes:
                    truncated = True
                    already = sum(len(c) for c in chunks)
                    remaining = max_bytes - already
                    if remaining > 0:
                        chunks.append(chunk[:remaining])
                    break

                chunks.append(chunk)

            return {
                "url": url,
                "status": status,
                "headers": headers,
                "data": b"".join(chunks),
                "truncated": truncated,
                "error": None,
            }

    except HTTPError as e:
        body = b""
        try:
            body = e.read(65536)
        except Exception:
            pass

        return {
            "url": url,
            "status": e.code,
            "headers": dict(e.headers),
            "data": body,
            "truncated": False,
            "error": str(e),
        }

    except URLError as e:
        return {
            "url": url,
            "status": None,
            "headers": {},
            "data": b"",
            "truncated": False,
            "error": str(e),
        }


def save_response(out_files, item):
    if not item["data"]:
        return None

    path = out_files / safe_name(item["url"])
    path.write_bytes(item["data"])
    return str(path)


def sanitize_source_path(source_name):
    source_name = source_name.replace("\\", "/")

    prefixes = [
        "webpack:///",
        "webpack://",
        "webpack:/",
        "vite:///",
        "file://",
        "../",
        "./",
    ]

    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if source_name.startswith(prefix):
                source_name = source_name[len(prefix):]
                changed = True

    parts = []
    for part in source_name.split("/"):
        if not part or part in [".", ".."]:
            continue
        if part.startswith("~"):
            part = part[1:]
        parts.append(part)

    if not parts:
        parts = ["unknown_source"]

    clean = "/".join(parts)
    clean = re.sub(r"[^A-Za-z0-9._/\-@()+\[\] ]+", "_", clean)
    return clean[:240]


def scan_text(source_url, text, report):
    for name, severity, pattern in SECRET_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            value = match.group(0)
            line = text.count("\n", 0, match.start()) + 1

            finding = {
                "source": source_url,
                "name": name,
                "severity": severity,
                "line": line,
                "match_redacted": redact(value),
            }

            dedupe_key = json.dumps(finding, sort_keys=True)
            if dedupe_key not in report["_seen_findings"]:
                report["_seen_findings"].add(dedupe_key)
                report["findings"].append(finding)

    firebase_config = {}
    for key in FIREBASE_KEYS:
        rgx = r'["\']?' + re.escape(key) + r'["\']?\s*:\s*["\']([^"\']+)["\']'
        match = re.search(rgx, text)
        if match:
            value = match.group(1)
            firebase_config[key] = redact(value) if key == "apiKey" else value

    if firebase_config:
        report["firebase_configs"].append({
            "source": source_url,
            "config": firebase_config,
        })

    for match in ABS_URL_RE.finditer(text):
        url = match.group(0).rstrip(".,);]'\"")
        if len(url) <= 300:
            report["absolute_urls"].setdefault(url, set()).add(source_url)

    for match in SOURCEMAP_RE.finditer(text):
        sourcemap = match.group(1).strip().strip("'\"")
        if sourcemap and not sourcemap.startswith("data:"):
            report["sourcemap_hints"].setdefault(resolve(source_url, sourcemap), set()).add(source_url)


def parse_sourcemap(source_url, text, report):
    try:
        obj = json.loads(text)
    except Exception:
        return

    if not isinstance(obj, dict):
        return

    sources = obj.get("sources") or []
    sources_content = obj.get("sourcesContent") or []

    if sources:
        report["sourcemaps"].append({
            "url": source_url,
            "version": obj.get("version"),
            "file": obj.get("file"),
            "source_count": len(sources),
            "sources_sample": sources[:80],
            "has_sources_content": bool(sources_content),
            "sources_content_count": len(sources_content),
        })

    for index, content in enumerate(sources_content):
        if not isinstance(content, str):
            continue

        name = sources[index] if index < len(sources) else f"sourcesContent[{index}]"
        virtual_source = f"{source_url} :: {name}"
        scan_text(virtual_source, content, report)


def reconstruct_sourcemap_sources(source_url, text, report, out_sources):
    try:
        obj = json.loads(text)
    except Exception:
        return

    if not isinstance(obj, dict):
        return

    sources = obj.get("sources") or []
    sources_content = obj.get("sourcesContent") or []

    if not sources or not sources_content:
        return

    extracted = []

    for index, content in enumerate(sources_content):
        if not isinstance(content, str):
            continue

        original_name = sources[index] if index < len(sources) else f"sourcesContent_{index}.txt"
        clean_path = sanitize_source_path(original_name).lstrip("/")
        dest = out_sources / clean_path
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists():
            h = hashlib.sha256((source_url + original_name).encode()).hexdigest()[:8]
            dest = dest.with_name(dest.stem + f"__{h}" + dest.suffix)

        dest.write_text(content, encoding="utf-8", errors="replace")

        extracted.append({
            "source_name": original_name,
            "saved_path": str(dest),
        })

    if extracted:
        report["reconstructed_sources"].append({
            "sourcemap": source_url,
            "count": len(extracted),
            "sample": extracted[:80],
        })


def normalize_report(report):
    for key in ["absolute_urls", "sourcemap_hints"]:
        normalized = []

        for value, sources in sorted(report[key].items()):
            normalized.append({
                "value": value,
                "sources": sorted(list(sources))[:10],
                "source_count": len(sources),
            })

        report[key] = normalized

    report.pop("_seen_findings", None)
    return report


def markdown_code_block(lines):
    if not lines:
        return "```text\n<no body preview>\n```"

    safe = []
    for line in lines:
        line = line.replace("```", "~~~")
        if len(line) > 500:
            line = line[:500] + " ...<truncated line>"
        safe.append(line)

    return "```text\n" + "\n".join(safe) + "\n```"


def write_markdown(report, path):
    lines = []

    def section(title):
        lines.append(f"\n## {title}\n")

    lines.append("# Passive public-resource verification report\n")
    lines.append(f"- Target: `{report['target']}`")
    lines.append(f"- Generated: `{report['generated_at']}`")
    lines.append(f"- Files fetched: `{len(report['fetched'])}`")
    lines.append(f"- Findings: `{len(report['findings'])}`")
    lines.append(f"- Sourcemaps: `{len(report['sourcemaps'])}`")
    lines.append(f"- Reconstructed source groups: `{len(report['reconstructed_sources'])}`")

    section("Probe file previews")

    probe_items = [item for item in report["fetched"] if item.get("reason") == "probe"]

    if not probe_items:
        lines.append("No probe files were requested.")
    else:
        for item in probe_items:
            lines.append(f"### `{item['url']}`")
            lines.append(f"- Status: `{item['status']}`")
            lines.append(f"- Classification: `{item['classification']}`")
            lines.append(f"- Content-Type: `{item['content_type']}`")
            lines.append(f"- Size: `{item['size']}` bytes")
            lines.append(f"- SHA-256: `{item['sha256']}`")
            lines.append(f"- Saved: `{item['saved_path']}`")
            if item.get("error"):
                lines.append(f"- Error: `{item['error']}`")
            lines.append("")
            lines.append(markdown_code_block(item.get("preview_lines", [])))
            lines.append("")

    section("Sourcemap previews")

    sourcemap_items = [
        item for item in report["fetched"]
        if item.get("reason", "").startswith("sourcemap") or item["url"].endswith(".map")
    ]

    if not sourcemap_items:
        lines.append("No sourcemap files were requested or found.")
    else:
        for item in sourcemap_items:
            lines.append(f"### `{item['url']}`")
            lines.append(f"- Status: `{item['status']}`")
            lines.append(f"- Classification: `{item['classification']}`")
            lines.append(f"- Content-Type: `{item['content_type']}`")
            lines.append(f"- Size: `{item['size']}` bytes")
            lines.append(f"- SHA-256: `{item['sha256']}`")
            lines.append(f"- Saved: `{item['saved_path']}`")
            if item.get("error"):
                lines.append(f"- Error: `{item['error']}`")
            lines.append("")
            lines.append(markdown_code_block(item.get("preview_lines", [])))
            lines.append("")

    section("Readable sourcemap summary")

    if not report["sourcemaps"]:
        lines.append("No valid JSON sourcemap detected.")
    else:
        for sm in report["sourcemaps"]:
            lines.append(
                f"- `{sm['url']}` - version `{sm['version']}`, sources `{sm['source_count']}`, "
                f"sourcesContent `{sm['has_sources_content']}` / count `{sm['sources_content_count']}`"
            )
            for src in sm["sources_sample"][:25]:
                lines.append(f"  - `{src}`")

    section("Critical / high-review findings")

    serious = [f for f in report["findings"] if f["severity"] in ["critical", "high_review"]]

    if not serious:
        lines.append("No critical/high-review key or secret patterns found.")
    else:
        for finding in serious[:250]:
            lines.append(
                f"- **{finding['severity']}** `{finding['name']}` in `{finding['source']}` "
                f"line `{finding['line']}` match `{finding['match_redacted']}`"
            )

    section("Firebase config hints")

    if not report["firebase_configs"]:
        lines.append("No Firebase config block detected.")
    else:
        for item in report["firebase_configs"]:
            lines.append(f"- Source: `{item['source']}`")
            for key, value in item["config"].items():
                lines.append(f"  - `{key}`: `{value}`")

    section("Reconstructed sources")

    if not report["reconstructed_sources"]:
        lines.append("No original source files reconstructed. This usually means sourcemaps were absent or did not include `sourcesContent`.")
    else:
        for group in report["reconstructed_sources"]:
            lines.append(f"- Sourcemap: `{group['sourcemap']}` - files: `{group['count']}`")
            for sample in group["sample"][:25]:
                lines.append(f"  - `{sample['source_name']}` -> `{sample['saved_path']}`")

    section("All fetched files")

    for item in report["fetched"][:500]:
        lines.append(
            f"- `{item['status']}` `{item['reason']}` `{item['classification']}` "
            f"`{item['url']}` size `{item['size']}` saved `{item['saved_path']}`"
        )

    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Passive public-resource verifier with probe/sourcemap previews")

    parser.add_argument("--target", default=DEFAULT_TARGET, help=f"Target URL. Default: {DEFAULT_TARGET}")
    parser.add_argument("--out", default=DEFAULT_OUTPUT_DIR, help=f"Output directory. Default: {DEFAULT_OUTPUT_DIR}")
    parser.add_argument("--preview-lines", type=int, default=DEFAULT_PREVIEW_LINES)
    parser.add_argument("--probe-common", action="store_true", default=DEFAULT_PROBE_COMMON)
    parser.add_argument("--no-probe-common", action="store_false", dest="probe_common")
    parser.add_argument("--allow-cross-origin-assets", action="store_true", default=DEFAULT_ALLOW_CROSS_ORIGIN_ASSETS)
    parser.add_argument("--no-guess-sourcemaps", action="store_true")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS)
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES_PER_FILE)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)

    args = parser.parse_args()

    target = args.target
    if not target.startswith(("http://", "https://")):
        target = "https://" + target

    script_dir = Path(__file__).resolve().parent
    out = Path(args.out)
    if not out.is_absolute():
        out = script_dir / out

    out_files = out / "files"
    out_sources = out / "reconstructed_sources"

    out.mkdir(parents=True, exist_ok=True)
    out_files.mkdir(parents=True, exist_ok=True)
    out_sources.mkdir(parents=True, exist_ok=True)

    report = {
        "target": target,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fetched": [],
        "findings": [],
        "firebase_configs": [],
        "sourcemaps": [],
        "reconstructed_sources": [],
        "sourcemap_hints": {},
        "absolute_urls": {},
        "_seen_findings": set(),
    }

    queue = []
    seen = set()

    def enqueue(url, reason):
        if not url:
            return

        url = urldefrag(url)[0]

        if url in seen:
            return

        if not args.allow_cross_origin_assets and not same_origin(target, url):
            return

        if not should_fetch_asset(url):
            return

        queue.append((url, reason))

    enqueue(target, "root")

    if args.probe_common:
        for probe_path in COMMON_PROBES:
            enqueue(resolve(target, probe_path), "probe")

    while queue and len(seen) < args.max_files:
        url, reason = queue.pop(0)

        if url in seen:
            continue

        seen.add(url)

        item = fetch(url, args.timeout, args.max_bytes, args.user_agent)
        saved_path = save_response(out_files, item)

        content_type = item["headers"].get("Content-Type", "")
        data = item["data"]
        classification = classify_response(url, reason, item["status"], content_type, data)

        rec = {
            "url": url,
            "reason": reason,
            "probe": reason == "probe",
            "status": item["status"],
            "classification": classification,
            "content_type": content_type,
            "size": len(data),
            "sha256": sha256_hex(data) if data else None,
            "truncated": item["truncated"],
            "saved_path": saved_path,
            "error": item["error"],
            "preview_lines": preview_lines(data, args.preview_lines)
            if reason == "probe" or reason.startswith("sourcemap") or url.endswith(".map")
            else [],
        }

        report["fetched"].append(rec)

        print(f"[{item['status']}] {reason}: {url}")
        if rec["preview_lines"] and (reason == "probe" or reason.startswith("sourcemap") or url.endswith(".map")):
            print(f"    classification: {classification}")
            for line in rec["preview_lines"][:args.preview_lines]:
                clean = line.replace("\t", " ").strip()
                if len(clean) > 140:
                    clean = clean[:140] + " ..."
                print(f"    | {clean}")

        if item["status"] and 200 <= item["status"] < 300 and data and not looks_binary(data):
            text = decode_text(data)
            scan_text(url, text, report)

            path_lower = urlparse(url).path.lower()

            if reason == "root" or "text/html" in content_type:
                html_parser = AssetParser(url)
                try:
                    html_parser.feed(text)
                except Exception:
                    pass

                for asset in sorted(html_parser.assets):
                    enqueue(asset, "linked_asset")

            if path_lower.endswith((".js", ".css")) or "javascript" in content_type or "text/css" in content_type:
                for sourcemap_url in list(report["sourcemap_hints"].keys()):
                    enqueue(sourcemap_url, "sourcemap_hint")

                if not args.no_guess_sourcemaps:
                    enqueue(url + ".map", "sourcemap_guess")

            if path_lower.endswith(".map") or reason.startswith("sourcemap"):
                parse_sourcemap(url, text, report)
                reconstruct_sourcemap_sources(url, text, report, out_sources)

        time.sleep(args.delay)

    normalized = normalize_report(report)

    json_path = out / "report.json"
    md_path = out / "report.md"

    json_path.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(normalized, md_path)

    print()
    print(f"[OK] target:          {target}")
    print(f"[OK] report markdown: {md_path}")
    print(f"[OK] report json:     {json_path}")
    print(f"[OK] downloaded:      {out_files}")
    print(f"[OK] reconstructed:   {out_sources}")
    print(f"[OK] fetched files:   {len(normalized['fetched'])}")
    print(f"[OK] findings:        {len(normalized['findings'])}")
    print(f"[OK] sourcemaps:      {len(normalized['sourcemaps'])}")


if __name__ == "__main__":
    main()
