#!/usr/bin/env python3
"""
Export decrypted X/Twitter cookies from a local Chrome profile on macOS.

This script reads the Chrome cookies SQLite database, decrypts macOS Chrome
cookies using the "Chrome Safe Storage" Keychain entry, and writes matching
cookies to a local JSON file.

Typical use:
  python3 scripts/export_chrome_x_cookies.py

By default it exports x.com and twitter.com cookies from the Chrome Default
profile to ./chrome-x-cookies.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

DEFAULT_BROWSER = "chrome"
DEFAULT_PROFILE = "Default"
DEFAULT_OUTPUT = Path.cwd() / "chrome-x-cookies.json"
DEFAULT_DOMAINS = [".x.com", "x.com", ".twitter.com", "twitter.com"]

BROWSER_BASE_DIRS = {
    "chrome": Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
    "chrome-canary": Path.home()
    / "Library"
    / "Application Support"
    / "Google"
    / "Chrome Canary",
    "chromium": Path.home() / "Library" / "Application Support" / "Chromium",
}

BROWSER_KEYCHAIN_ACCOUNT = {
    "chrome": ("Chrome", "Chrome Safe Storage"),
    "chrome-canary": ("Chrome Canary", "Chrome Safe Storage"),
    "chromium": ("Chromium", "Chromium Safe Storage"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export decrypted x.com/twitter.com cookies from local Chrome."
    )
    parser.add_argument(
        "--browser",
        choices=sorted(BROWSER_BASE_DIRS.keys()),
        default=DEFAULT_BROWSER,
        help="Browser profile family to read from (default: chrome).",
    )
    parser.add_argument(
        "--profile",
        default=DEFAULT_PROFILE,
        help="Chrome profile directory name (default: Default).",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"Output JSON file path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--domain",
        action="append",
        dest="domains",
        help="Cookie domain to include. Repeatable. Defaults to x.com/twitter.com cookies only.",
    )
    parser.add_argument(
        "--name",
        action="append",
        dest="names",
        help="Cookie name filter. Repeatable. If omitted, exports all matching domain cookies.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Also print the exported JSON to stdout.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output.",
    )
    return parser.parse_args()


def resolve_cookie_db(browser: str, profile: str) -> Path:
    base_dir = BROWSER_BASE_DIRS[browser]
    candidates = [
        base_dir / profile / "Cookies",
        base_dir / profile / "Network" / "Cookies",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Could not find a Cookies database for browser={browser!r} profile={profile!r}."
    )


def get_safe_storage_passphrase(browser: str) -> bytes:
    account, service = BROWSER_KEYCHAIN_ACCOUNT[browser]
    cmd = ["security", "find-generic-password", "-a", account, "-s", service, "-w"]
    try:
        return subprocess.check_output(cmd, text=True).strip().encode("utf-8")
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"Failed to read Keychain item {service!r}. You may need to allow Keychain access."
        ) from exc


def derive_key(passphrase: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha1", passphrase, b"saltysalt", 1003, dklen=16)


def decrypt_cookie_value(encrypted_value: bytes, key: bytes, db_version: int) -> str:
    if not encrypted_value:
        return ""
    if not encrypted_value.startswith(b"v10"):
        return encrypted_value.decode("utf-8", errors="ignore")

    proc = subprocess.run(
        [
            "openssl",
            "enc",
            "-aes-128-cbc",
            "-d",
            "-nopad",
            "-K",
            key.hex(),
            "-iv",
            (b" " * 16).hex(),
        ],
        input=encrypted_value[3:],
        capture_output=True,
        check=True,
    )
    raw = proc.stdout
    if raw:
        padding = raw[-1]
        if 1 <= padding <= 16:
            raw = raw[:-padding]
    if db_version >= 24 and len(raw) >= 32:
        raw = raw[32:]
    return raw.decode("utf-8", errors="ignore")


def expand_domains(domains: Iterable[str]) -> list[str]:
    expanded: list[str] = []
    for domain in domains:
        value = domain.strip()
        if not value:
            continue
        expanded.append(value)
        if not value.startswith("."):
            expanded.append(f".{value}")
    # Preserve order but dedupe.
    seen: set[str] = set()
    result: list[str] = []
    for value in expanded:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def same_site_name(raw_value: int) -> str:
    return {
        0: "None",
        1: "Lax",
        2: "Strict",
        -1: "None",
    }.get(raw_value, "None")


def load_matching_cookies(
    cookie_db_path: Path,
    domains: list[str],
    names: set[str] | None,
    key: bytes,
) -> list[dict[str, object]]:
    with tempfile.NamedTemporaryFile(delete=False) as temp_file:
        temp_path = Path(temp_file.name)
    shutil.copy2(cookie_db_path, temp_path)

    try:
        connection = sqlite3.connect(str(temp_path))
        cursor = connection.cursor()
        cursor.execute("SELECT value FROM meta WHERE key = 'version'")
        meta_row = cursor.fetchone()
        db_version = int(meta_row[0]) if meta_row else 0

        placeholders = ",".join("?" for _ in domains)
        query = f"""
            SELECT
              host_key,
              name,
              value,
              encrypted_value,
              path,
              expires_utc,
              is_secure,
              is_httponly,
              samesite
            FROM cookies
            WHERE host_key IN ({placeholders})
        """
        params: list[object] = list(domains)
        if names:
            name_placeholders = ",".join("?" for _ in names)
            query += f" AND name IN ({name_placeholders})"
            params.extend(sorted(names))

        query += " ORDER BY host_key, name"
        cursor.execute(query, params)

        cookies: list[dict[str, object]] = []
        for (
            host_key,
            name,
            value,
            encrypted_value,
            path_value,
            expires_utc,
            is_secure,
            is_httponly,
            samesite,
        ) in cursor.fetchall():
            decrypted = value or ""
            if not decrypted:
                decrypted = decrypt_cookie_value(encrypted_value, key, db_version)
            if not decrypted:
                continue
            cookies.append(
                {
                    "domain": host_key,
                    "name": name,
                    "value": decrypted,
                    "path": path_value or "/",
                    "expiresUtc": expires_utc,
                    "secure": bool(is_secure),
                    "httpOnly": bool(is_httponly),
                    "sameSite": same_site_name(int(samesite)),
                }
            )
        return cookies
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def write_output(output_path: Path, payload: dict[str, object], pretty: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(payload, ensure_ascii=False)
    output_path.write_text(text + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    domains = expand_domains(args.domains or DEFAULT_DOMAINS)
    names = {name.strip() for name in (args.names or []) if name.strip()} or None

    cookie_db_path = resolve_cookie_db(args.browser, args.profile)
    passphrase = get_safe_storage_passphrase(args.browser)
    key = derive_key(passphrase)
    cookies = load_matching_cookies(cookie_db_path, domains, names, key)

    payload: dict[str, object] = {
        "browser": args.browser,
        "profile": args.profile,
        "cookieDbPath": str(cookie_db_path),
        "domains": domains,
        "names": sorted(names) if names else None,
        "count": len(cookies),
        "cookies": cookies,
    }

    write_output(output_path, payload, pretty=args.pretty)
    print(f"Exported {len(cookies)} cookies to {output_path}")

    if args.stdout:
      if args.pretty:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
      else:
        print(json.dumps(payload, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
