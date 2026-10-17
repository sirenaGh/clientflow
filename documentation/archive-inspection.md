# Archive inspection

The review archive was built from an explicit source/documentation allowlist and inspected again after compression.

- Includes frontend/backend source, schema/migrations/seeds, manifests/lockfile, tests/configuration/workflow, all project documentation, a placeholder-only environment example, and 15 fictional-data screenshots.
- Excludes actual environment files, local credentials, session/database data, dumps, dependencies, Git metadata, build output, caches, browser traces, and raw test-result directories.
- Scans file bytes for actual locally configured credentials and session secrets without printing or exporting those values, plus private keys, persisted password hashes, token patterns, and non-placeholder MySQL connection passwords.
- Checks screenshot file structure and rejects textual/EXIF metadata. Pixel contents were visually reviewed separately; no password-filled login screen is included.
- Allows only the versioned Prisma migration SQL files; no database export SQL is included.
- Checks ZIP paths, CRC integrity, file count, and SHA-256 hashes against `review-archive-manifest.json`. The manifest excludes its own hash to avoid a circular reference.
- This is a focused local inspection, not a guarantee against every possible sensitive-data pattern. Required third-party licenses and legitimate attribution are preserved.

The ZIP and its SHA-256 sidecar are written under the ignored `review-package` directory. Rebuild with `python scripts/package-review.py` after regenerating screenshots and updating verification results.
