# Matrix AI EDU (`mis.oanhcuongdo.com`) — Điều tra thành phần, chức năng & Thiết kế MCP

## 1. Thông tin phiên User đã kiểm chứng (Read-only, Redacted)

- **User ID**: `<user-uuid>` *(thông tin tài khoản thật lưu cục bộ tại `context/PROFILE.md`, gitignored)*
- **Role**: `instructor`
- **TLU Link Status**: `NOT_LINKED`
- **Projects tham chiếu**: lưu danh sách UUID và tên dự án thực tế tại gitignored `context/directory.md` (ví dụ mẫu cấu trúc `/projects/{project_id}` với trạng thái `ACTIVE`).

> Token Bearer đã được trích xuất chỉ đọc từ cookie `access_token` vào file gitignored `.env.mis` (tái trích xuất bất cứ lúc nào bằng tool `mis_refresh_token_from_cdp`; script khởi tạo ban đầu lưu cục bộ tại `scripts/legacy/extract-bearer-and-user.mjs`).

## 2. Kiến trúc Web & Các trang/module UI

- **Kiến trúc**: FastAPI SSR (HTML templates + Tailwind CSS CDN + TomSelect + inline Vanilla JS gọi `/api/v1/...`).
- **Thanh điều hướng chính (Header/Nav)**:
  - `/dashboard` — **Tổng quan** (Dashboard cá nhân & danh sách lớp học phần)
  - `/courses` — **Lớp học phần** (Tham gia lớp bằng `join_code`, tạo lớp LMS mới)
  - `/projects/` — **Dự án học tập** (Danh sách dự án, KPI `/projects/performance`, trang chi tiết `/projects/{project_id}`)
  - `/gallery` — **Thư viện video** (Video đã upload, chờ xử lý, tài liệu học phần, trang chi tiết `/video/{slug}`)
  - `/login` (Google OAuth `/api/v1/auth/google/login` & legacy TLU login) và `/admin` (`/admin/login` cho quản trị)

### Các trang đã crawl (GET-only)

| Route | HTTP | Title | Headings chính | Số control | Số button |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | 200 | Tổng quan · Matrix AI EDU | Xin chào, `<User>`; Lớp học phần của tôi | 0 | 3 |
| `/courses` | 200 | Lớp học phần · Matrix AI EDU | Lớp học phần; Tham gia lớp; Tạo lớp LMS | 6 | 5 |
| `/projects` | 200 | Dự án học tập · Matrix AI EDU | Quản lý các dự án trong hệ thống | 4 | 10 |
| `/gallery` | 200 | Thư viện video · Matrix AI EDU | Thư viện video; Video upload thành công | 3 | 4 |
| `/login` | 200 | Đăng nhập · Matrix AI EDU | Đăng nhập LMS | 0 | 2 |
| `/admin` | 200 | Đăng nhập quản trị · Matrix AI EDU | Đăng nhập quản trị | 4 | 3 |
| `/projects/` | 200 | Dự án học tập · Matrix AI EDU | Quản lý các dự án trong hệ thống | 4 | 10 |
| `/projects/performance` | 200 | Thống kê & Đánh giá KPI Sinh viên Dự án · Matrix AI EDU | Báo cáo Performance & Đánh giá KPI Sinh viên Dự án học tập; Chi tiết nhiệm vụ sinh viên | 11 | 28 |
| `/projects/{project_id}` | 200 | `<Project>` · Matrix AI EDU | `<Project>`; Danh sách thành viên; Tài liệu dự án; Hoạt động & AI | 33 | 39 |
| `/projects/{project_id}?task_id={task_id}` | 200 | `<Project>` · Matrix AI EDU | `<Project>`; Danh sách thành viên; Tài liệu dự án; Hoạt động & AI | 33 | 39 |
| `/video/{slug}` | 200 | `<Video Title>` · Matrix AI EDU | `<Video Title>` | 0 | 4 |

## 3. Phân tích chi tiết trang Dự án (`/projects/{project_id}`)

Trang dự án là workspace làm việc chính gồm 3 tab + slide-over panel + các modal:

- **Tab 1 — Công việc (Tasks) (`#pane-board`)**:
  - Filter pills: `Tất cả`, `Của tôi`, `✋ Việc mở`.
  - Bảng Tasks (`TÊN TASK`, `TRẠNG THÁI`, `PHỤ TRÁCH`, `DEADLINE`, `TIẾN ĐỘ`) hỗ trợ task cha/con và kéo-thả đổi trạng thái (`PATCH /api/v1/projects/{project_id}/tasks/{task_id}`).
  - Nút `+ Thêm Task` mở `#modal-create-task` (`POST /api/v1/projects/{project_id}/tasks/`).
- **Tab 2 — Thành viên (`#pane-members`)**:
  - Bảng thành viên + Role + Task đang làm.
  - Thêm/xóa thành viên (`POST/DELETE /api/v1/projects/{project_id}/members`), modal tạo/thu hồi link mời (`POST/DELETE /api/v1/projects/{project_id}/invite`).
- **Tab 3 — Tài liệu (`#pane-documents`)**:
  - Danh sách tài liệu dự án, tải file, phân tích/tóm tắt AI, tạo task từ tài liệu (`POST .../documents/{doc_id}/create-task`), upload chunked (>5MB).
- **Sidebar Hoạt động & AI**:
  - Feed hoạt động (`GET /api/v1/projects/{project_id}/feed`), gửi comment dự án (`POST .../comments`), tổng hợp AI (`GET .../ai-summary`).
- **Panel Chi tiết Task (`#task-detail-panel`)**:
  - Chỉnh sửa tiêu đề, trạng thái (`TODO`, `IN_PROGRESS`, `INTERNAL_REVIEW`, `MENTOR_REVIEW`, `DONE` - chỉ PM/Mentor duyệt `DONE`), assignee, parent, deadline, estimated/actual hours, mô tả.
  - Nhận việc mở (`POST .../claim`) & trả việc (`POST .../release`).
  - Checklist (`POST/PATCH/DELETE .../checklists`, `POST .../generate-checklist`).
  - Nộp báo cáo kết quả & minh chứng (`POST .../reports` hoặc `upload-report-chunked`, xem log `.../view-log`, tải file `.../download`).
  - Comment task (`POST .../comments`) và Hỏi AI theo ngữ cảnh task (`POST .../documents/task-context/explain`).

### Controls & Inputs phát hiện trên trang Project (Read-only inventory)

| Element ID | Tag | Type / Role | Placeholder / Ghi chú |
| --- | --- | --- | --- |
| `project-comment-input` | `textarea` | `-` | Thêm bình luận chung... |
| `task-title` | `input` | `text` | VD: Thiết kế database schema |
| `task-parent-id` | `select` | `-` | - |
| `task-desc` | `textarea` | `-` | Mô tả chi tiết công việc cần làm... |
| `task-status` | `select` | `-` | - |
| `task-assignee` | `select` | `-` | - |
| `task-estimated-hours` | `input` | `number` | VD: 4.5 |
| `task-deadline` | `input` | `date` | - |
| `task-is-claimable` | `input` | `checkbox` | - |
| `doc-title` | `input` | `text` | Tên tài liệu |
| `doc-content` | `textarea` | `-` | Dán nội dung văn bản vào đây... |
| `doc-file` | `input` | `file` | - |
| `task-from-doc-id` | `input` | `hidden` | - |
| `tfd-title` | `input` | `text` | VD: Phân tích yêu cầu chương 1 |
| `tfd-desc` | `textarea` | `-` | Chi tiết cần thực hiện... |
| `tfd-assignee` | `select` | `-` | - |
| `tfd-deadline` | `input` | `date` | - |
| `member-user-id` | `select` | `-` | - |
| `member-user-id-ts-control` | `input` | `select-one` | -- Chọn thành viên -- |
| `member-role` | `select` | `-` | - |
| `invite-link-input` | `input` | `text` | - |
| `detail-title` | `input` | `text` | Tên công việc |
| `detail-status` | `select` | `-` | - |
| `detail-assignee` | `select` | `-` | - |
| `detail-parent` | `select` | `-` | - |
| `detail-deadline` | `input` | `datetime-local` | - |
| `detail-estimated-hours` | `input` | `number` | giờ |
| `detail-actual-hours` | `input` | `number` | giờ |
| `detail-desc` | `textarea` | `-` | Mô tả công việc... |
| `task-report-text` | `textarea` | `-` | Mô tả công việc đã làm, kết quả đạt được, ghi chú cần review... |
| `task-report-link` | `input` | `url` | https://docs.google.com/... hoặc link Figma |
| `task-report-file` | `input` | `file` | - |
| `new-task-comment` | `input` | `text` | Viết bình luận... |
| `ai-ask-input` | `textarea` | `-` | Bạn cần hỗ trợ gì về công việc này? |

## 4. Đề xuất thiết kế MCP Server (`mis_matrix`) cho Agent

Tất cả gọi API đều dùng `MIS_BASE_URL=https://mis.oanhcuongdo.com` kèm header `Authorization: Bearer <MIS_BEARER_TOKEN>`.

### Nhóm Read-only Tools (an toàn gọi tự do)
1. `mis_get_me` -> `GET /api/v1/auth/me` (xác minh identity & role hiện tại)
2. `mis_list_projects` -> `GET /api/v1/projects/` (danh sách dự án)
3. `mis_get_project` -> `GET /api/v1/projects/{project_id}` (chi tiết dự án, thành viên, invite token)
4. `mis_get_project_feed` -> `GET /api/v1/projects/{project_id}/feed` (nhật ký hoạt động)
5. `mis_list_tasks` -> `GET /api/v1/projects/{project_id}/tasks/` (toàn bộ tasks của dự án)
6. `mis_get_task` -> `GET /api/v1/projects/{project_id}/tasks/{task_id}` (chi tiết task, checklists, reports, comments)
7. `mis_read_task_log` -> `GET /api/v1/projects/{project_id}/tasks/{task_id}/reports/{report_id}/view-log` (đọc log minh chứng)
8. `mis_list_documents` -> `GET /api/v1/projects/{project_id}/documents/` & đọc file/nội dung
9. `mis_project_performance` -> `GET /api/v1/projects/performance/data` (nếu có trong OpenAPI — xem KPI)
10. `mis_list_courses` / `mis_get_course_roster` / `mis_list_assignments` / `mis_list_gallery` -> các `GET` bên LMS/Courses/Gallery

### Nhóm Write / Mutation Tools (nên gắn xác nhận / audit rõ ràng)
1. `mis_create_task` -> `POST /api/v1/projects/{project_id}/tasks/`
2. `mis_update_task` -> `PATCH /api/v1/projects/{project_id}/tasks/{task_id}` (đổi status, hours, assignee, deadline...)
3. `mis_claim_task` / `mis_release_task` -> `POST .../claim`, `POST .../release`
4. `mis_manage_checklist` -> `POST/PATCH/DELETE .../checklists/...`
5. `mis_submit_task_report` -> `POST .../reports` (text, link, file multipart hoặc chunked)
6. `mis_post_comment` -> `POST .../comments` (task hoặc project)
7. `mis_ai_summarize_project` / `mis_ai_ask_task` -> `GET .../ai-summary`, `POST .../documents/task-context/explain`
