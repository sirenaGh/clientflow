"""Build and inspect a source-only ClientFlow review archive using an allowlist."""
from pathlib import Path, PurePosixPath
from datetime import date
from hashlib import sha256
from urllib.parse import urlsplit, unquote
import json
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "review-package"
MANIFEST = "documentation/review-archive-manifest.json"
INSPECTION = "documentation/archive-inspection.md"
TREES = [".github", "client/src", "client/e2e", "client/review", "server/src", "server/prisma", "server/test", "scripts", "documentation"]
FILES = [".gitignore", ".nvmrc", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "package.json", "package-lock.json", "eslint.config.js", "playwright.config.ts", "playwright.review.config.ts", "client/package.json", "client/tsconfig.json", "client/vite.config.ts", "client/index.html", "server/package.json", "server/tsconfig.json", "server/prisma.config.ts", "server/.env.example"]
FORBIDDEN = {".git", "node_modules", "dist", ".runtime", "test-results", "playwright-report", "coverage", "__pycache__", ".cache", "review-package"}
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".html", ".yml", ".yaml", ".toml", ".prisma", ".py", ".example", ".txt"}


def acceptable(relative):
    p = PurePosixPath(relative)
    if p.is_absolute() or ".." in p.parts or any(part in FORBIDDEN for part in p.parts):
        return False
    if p.name == ".env" or (p.name.startswith(".env.") and p.name != ".env.example"):
        return False
    if p.suffix == ".sql":
        return relative.startswith("server/prisma/migrations/") and p.name == "migration.sql"
    if p.suffix == ".png":
        return relative.startswith("documentation/screenshots/")
    return p.suffix in TEXT_SUFFIXES or p.name in {".gitignore", ".nvmrc", "LICENSE", "NOTICE"}


def candidates():
    selected = set(FILES)
    for name in TREES:
        base = ROOT / name
        for file in base.rglob("*"):
            if file.is_symlink():
                raise RuntimeError("Refusing symbolic links in review source")
            if file.is_file():
                selected.add(file.relative_to(ROOT).as_posix())
    return sorted(name for name in selected if name != MANIFEST and acceptable(name) and (ROOT / name).is_file())


def local_secrets():
    values = set()
    for file in [ROOT / ".env", ROOT / "server/.env"]:
        if not file.exists():
            continue
        for line in file.read_text(encoding="utf-8").splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip("\"'")
            if re.search(r"PASSWORD|SECRET|TOKEN|DATABASE_URL", key) and len(value) >= 12:
                values.add(value.encode())
                if "DATABASE_URL" in key:
                    password = urlsplit(value).password
                    if password:
                        values.add(unquote(password).encode())
    file = ROOT / ".runtime/mysql-root"
    if file.exists():
        values.add(file.read_bytes().strip())
    return [value for value in values if len(value) >= 12]


def inspect(name, payload, secrets):
    if not acceptable(name):
        raise RuntimeError("Excluded path found in archive: " + name)
    if any(value in payload for value in secrets):
        raise RuntimeError("Sensitive local value detected in " + name)
    if name.endswith(".png"):
        if payload[:8] != b"\x89PNG\r\n\x1a\n":
            raise RuntimeError("Invalid screenshot format: " + name)
        cursor = 8
        while cursor < len(payload):
            size = struct.unpack(">I", payload[cursor:cursor + 4])[0]
            kind = payload[cursor + 4:cursor + 8]
            if kind in {b"tEXt", b"zTXt", b"iTXt", b"eXIf"}:
                raise RuntimeError("Screenshot metadata requires inspection: " + name)
            cursor += size + 12
        return
    text = payload.decode("utf-8")
    if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text):
        raise RuntimeError("Private key detected in " + name)
    if re.search(r"\$argon2(?:id|i|d)\$v=\d+\$", text):
        raise RuntimeError("Persisted password hash detected in " + name)
    if re.search(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", text):
        raise RuntimeError("Token-like credential detected in " + name)
    for connection in re.findall(r"mysql://[^\s\"'<>`]+", text):
        if "@" not in connection:
            continue
        password = urlsplit(connection).password
        if password and not re.search(r"CHANGE_ME|REPLACE|DB_PASSWORD|\$|\{|<", password):
            raise RuntimeError("Non-placeholder connection credential in " + name)


def main():
    OUTPUT.mkdir(exist_ok=True)
    secrets = local_secrets()
    selected = candidates()
    screenshots = [name for name in selected if name.endswith(".png")]
    if len(screenshots) not in (15, 19):
        raise RuntimeError("Expected 15 core screenshots and either all four visitor screenshots or none")
    report = f"""# Archive inspection

The review archive was built from an explicit source/documentation allowlist and inspected again after compression.

- Includes frontend/backend source, schema/migrations/seeds, manifests/lockfile, tests/configuration/workflow, all project documentation, a placeholder-only environment example, and {len(screenshots)} fictional-data screenshots.
- Excludes actual environment files, local credentials, session/database data, dumps, dependencies, Git metadata, build output, caches, browser traces, and raw test-result directories.
- Scans file bytes for actual locally configured credentials and session secrets without printing or exporting those values, plus private keys, persisted password hashes, token patterns, and non-placeholder MySQL connection passwords.
- Checks screenshot file structure and rejects textual/EXIF metadata. Pixel contents were visually reviewed separately; no password-filled login screen is included.
- Allows only the versioned Prisma migration SQL files; no database export SQL is included.
- Checks ZIP paths, CRC integrity, file count, and SHA-256 hashes against `review-archive-manifest.json`. The manifest excludes its own hash to avoid a circular reference.
- This is a focused local inspection, not a guarantee against every possible sensitive-data pattern. Required third-party licenses and legitimate attribution are preserved.

The ZIP and its SHA-256 sidecar are written under the ignored `review-package` directory. Rebuild with `python scripts/package-review.py` after regenerating screenshots and updating verification results.
"""
    (ROOT / INSPECTION).write_text(report, encoding="utf-8")
    selected = candidates()
    records = []
    for name in selected:
        payload = (ROOT / name).read_bytes()
        inspect(name, payload, secrets)
        records.append({"path": name, "bytes": len(payload), "sha256": sha256(payload).hexdigest()})
    manifest = {"archive_root": "ClientFlow", "files": records, "excludes_own_hash": True}
    (ROOT / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    selected.append(MANIFEST)
    archive = OUTPUT / f"ClientFlow-review-{date.today().isoformat()}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name in sorted(selected):
            package.write(ROOT / name, "ClientFlow/" + name)
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None or len(package.namelist()) != len(selected):
            raise RuntimeError("ZIP integrity or file count mismatch")
        for name in package.namelist():
            if not name.startswith("ClientFlow/"):
                raise RuntimeError("Unexpected archive root")
            inspect(name.removeprefix("ClientFlow/"), package.read(name), secrets)
        for record in records:
            if sha256(package.read("ClientFlow/" + record["path"])).hexdigest() != record["sha256"]:
                raise RuntimeError("Archive manifest hash mismatch")
    digest = sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".sha256").write_text(digest + "  " + archive.name + "\n", encoding="ascii")
    print(json.dumps({"archive": str(archive), "files": len(selected), "screenshots": len(screenshots), "bytes": archive.stat().st_size, "sha256": digest, "inspection": "passed"}, indent=2))


if __name__ == "__main__":
    main()
