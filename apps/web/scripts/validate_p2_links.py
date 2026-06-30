from __future__ import annotations

import json
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = {
    "/": "src/app/(default)/page.tsx",
    "/api/v1/[[...path]]": "src/app/api/v1/[[...path]]/route.ts",
    "/assets": "src/app/(default)/(protected)/assets/page.tsx",
    "/create/video": "src/app/(default)/(protected)/create/video/page.tsx",
    "/drama/[id]": "src/app/(default)/drama/[id]/page.tsx",
    "/drama/[id]/episode/[episodeNumber]": "src/app/(studio)/drama/[id]/episode/[episodeNumber]/page.tsx",
    "/my": "src/app/(default)/(protected)/my/page.tsx",
    "/settings": "src/app/(default)/(protected)/settings/page.tsx",
    "/tasks": "src/app/(default)/(protected)/tasks/page.tsx",
    "/writing": "src/app/(default)/(protected)/writing/page.tsx",
    "/writing/[id]": "src/app/(default)/(protected)/writing/[id]/page.tsx",
}


def main() -> int:
    checked_routes: list[dict[str, str]] = []
    missing_routes: list[dict[str, str]] = []

    for route, relative_file in REQUIRED_FILES.items():
        absolute_file = WEB_ROOT / relative_file
        payload = {
            "route": route,
            "file": relative_file,
        }
        if absolute_file.exists():
            checked_routes.append(payload)
        else:
            missing_routes.append(payload)

    report = {
        "webRoot": str(WEB_ROOT),
        "checkedRoutes": checked_routes,
        "missingRoutes": missing_routes,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if missing_routes else 0


if __name__ == "__main__":
    raise SystemExit(main())
