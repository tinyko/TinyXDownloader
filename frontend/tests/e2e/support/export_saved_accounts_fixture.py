#!/usr/bin/env python3

import json
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "Usage: export_saved_accounts_fixture.py <seeded-sqlite> <output-json>",
            file=sys.stderr,
        )
        return 1

    source_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(source_path)
    connection.row_factory = sqlite3.Row

    rows = connection.execute(
        """
        SELECT
          id,
          username,
          name,
          profile_image,
          total_media,
          last_fetched,
          group_name,
          group_color,
          media_type,
          timeline_type,
          retweets,
          query_key,
          cursor,
          completed,
          followers_count,
          statuses_count
        FROM accounts
        ORDER BY id ASC
        """
    ).fetchall()
    connection.close()

    accounts = []
    groups = {}
    public_count = 0
    private_count = 0

    for row in rows:
        username = str(row["username"] or "")
        is_private = username.lower() in {"bookmarks", "likes"}
        if is_private:
            private_count += 1
        else:
            public_count += 1

        group_name = str(row["group_name"] or "")
        group_color = str(row["group_color"] or "")
        if not is_private and group_name:
            groups[group_name] = group_color

        accounts.append(
            {
                "id": int(row["id"] or 0),
                "username": username,
                "name": str(row["name"] or ""),
                "profile_image": str(row["profile_image"] or ""),
                "total_media": int(row["total_media"] or 0),
                "last_fetched": str(row["last_fetched"] or ""),
                "group_name": group_name,
                "group_color": group_color,
                "media_type": str(row["media_type"] or "all"),
                "timeline_type": str(row["timeline_type"] or "timeline"),
                "retweets": bool(row["retweets"]),
                "query_key": str(row["query_key"] or ""),
                "cursor": str(row["cursor"] or ""),
                "completed": bool(row["completed"]),
                "followers_count": int(row["followers_count"] or 0),
                "statuses_count": int(row["statuses_count"] or 0),
            }
        )

    payload = {
        "public_count": public_count,
        "private_count": private_count,
        "groups": [
            {"name": name, "color": color}
            for name, color in sorted(groups.items(), key=lambda item: item[0].lower())
        ],
        "accounts": accounts,
    }

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

    print(f"Exported {len(accounts)} saved-account fixture rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
