# Workspace Utility Scripts (`scripts/`)

Thư mục này chứa các script tiện ích Node.js (zero-dependency, dùng relative paths theo workspace hiện tại).

## Active Scripts

- [analyze-openapi.mjs](analyze-openapi.mjs) — Đọc `reports/openapi.json` và `reports/crawl-summary.json`, tổng hợp metadata endpoint theo tag & danh sách page vào `reports/openapi-summary.json`.
- [build-docs.mjs](build-docs.mjs) — Sinh tài liệu tham chiếu `docs/MIS-API-REFERENCE.md` và `docs/MIS-UI-AND-MCP-BLUEPRINT.md` từ dữ liệu đã thu thập trong `reports/`.

## Legacy Scripts

Các script CDP/crawl one-off trong giai đoạn điều tra ban đầu được lưu giữ có kiểm soát tại [scripts/legacy/MANIFEST.md](legacy/MANIFEST.md) để bảo toàn provenance.
