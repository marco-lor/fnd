# Task15A acceptance checklist

This is the current acceptance contract reconstructed from the user objective, the Task15 roadmap and the supplied October20 evidence/runbook. The original fifteen-row checklist was not included in that archive; these identifiers are new, not recovered historical approvals. Historical observations do not satisfy the final-release checks.

Source: `docs/superpowers/specs/2026-10-25-task15a-finalization-design.md`. Supplied archive SHA256: `312af59359c8fc6a94a86aee63cf1ecd405688b3c7530a5a483c64861f1f7c0b` (61 manifest entries verified). Current user authorization includes staging and production, superseding the historical report's staging-only scope.

Statuses: PENDING, PASS, FAIL, BLOCKED, NOT VERIFIED. A PASS must identify the source/build, site/live version, engine/device and fresh evidence. Automated local, emulator, live browser and physical-device results remain distinct.

| ID | Required result | Current status |
| --- | --- | --- |
| A01 | Original masters preserved; complete exact-ratio modern assets, hashes, decode, manifest and reproducible `maps:check` validated. | PASS local integrity; final deployed identity pending |
| A02 | Cold successful AVIF/WebP delivery counts all actual image HTTP bodies, including other Echi images and unintended duplicates, and stays <=4,466,801 bytes at declared viewport/DPR combinations. | PASS map-only CI; live all-image matrix pending |
| A03 | First map eager/high; lower map sends no URL/request before its image surface reaches viewport+320CSSpx; reserved space and one-way activation remain stable. | PASS native/CI; live version pending |
| A04 | Unsupported formats, HTTP errors, corrupt decode and interrupted requests advance finitely through WebP/PNG to a usable terminal error; replaced/unmounted attempts stop network work. | PASS native/CI faults; live faults pending |
| A05 | Both maps retain complete perimeter, aspect ratio and readable small labels against PNG at the same geometry, across selected responsive candidates and zoom. | PENDING whole-map visual matrix |
| A06 | Marker displacement <=1CSSpx through placeholder/decode, all formats/errors, hover, menu changes, resize, zoom and route return. | PENDING actual route |
| A07 | True desktop browser zoom200%: whole page, marker/sidebar popups, palette, dialogs, keyboard focus/Escape and last NPC notes remain accessible without clipping. | PASS native focus/viewport tests; true zoom pending |
| A08 | Direct navigation, login/role transitions, ordinary reload and Home/Echi roundtrips work with original authorization behavior and no introduced runtime errors. | PENDING final release |
| A09 | Owned public/private pins and NPC UI workflows: cancel/create/info/move/confirm/delete, isolation across account/scope/map, reload persistence and server result checks. | PENDING owned fixture matrix |
| A10 | Slow-network route exit with pending lower map then return finishes coherently; normal image cache behavior distinguishes bodies/304/cache/overhead. | PENDING final release |
| A11 | Expected fonts actually render on headings, controls, popup and dialog text at100%/true200%, with inspector font evidence. | PENDING final release |
| A12 | Real ordinary-session App Check exchange, valid token metadata and successful enforced endpoint request without debug tokens or protection changes. | Real provider HTTP200/TTL3600 in automated WebKit; ordinary PC/enforced endpoint pending |
| A13 | Changed-release cache continuity: preserved ordinary-cache oldHTML still demonstrably fresh, different main hashes, navigation before any reload, separate ordinary reload and cold profile; live HTML/static/runtime headers and release identity verified. | PENDING publish |
| A14 | Browser coverage: Chromium, Firefox where operational, Linux WebKit regression; Safari macOS and physical smartphone/tablet/touch/rotation results accurately distinguished and completed where required. | PENDING; no physical device access established |
| A15 | Independent final code/release review, required tests/CI, PR15-minute comment windows, verified owned-fixture/Auth/derivative cleanup, originals unchanged, same reviewed source deployed, merged PRs, clean Git and no temporary branches. | PENDING rollout |

The roadmap explicitly specifies a **modern-format** transfer target. That is the scope of A02. Every failure-injection/fallback report must still count all observed/provided bytes and disclose incomplete measurements; it does not receive an A02 PASS by omitting failures. The lossless PNG masters total14,889,339bytes and are retained for compatibility/quality when both modern formats fail. Their fallback traffic is reported separately and exceeds the nominal modern budget. Corrupt-response synthetic bodies with unavailable browser byte instrumentation are recorded as injected bytes/unknown observed bytes, never assumed zero.

The seven-day previous-asset window protects the first transition from one-hour-fresh cached HTML and recently open runtimes. It is bounded retention, not a promise that indefinitely old tabs can load retired lazy chunks forever. No deployment or production acceptance is established by this document alone.
