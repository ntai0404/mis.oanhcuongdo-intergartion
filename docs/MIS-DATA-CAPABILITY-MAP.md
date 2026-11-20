# MIS Data Capability Map

Audit ngày 20/11/2026 theo giờ Việt Nam trên tài khoản `instructor`. Tài khoản thấy 7 dự án, 155 task và 94 subtask. Kết quả quyền truy cập áp dụng cho phiên này.

## Phạm vi kiểm chứng

- MCP công bố 49 tools, gồm 31 tool gắn `readOnlyHint: true` và 18 tool gắn `false`. Audit đọc cả registry lẫn handler. Các tool tải file, xuất snapshot và refresh token có hiệu ứng cục bộ. Audit live gọi API đọc trực tiếp hoặc đi qua MCP trong `MIS_READ_ONLY`. Nhóm 18 tool có thể ghi ở trạng thái `NOT_TESTED` trên MIS live.
- OpenAPI live công bố 147 operations và 135 schemas. Hai operation tăng so với bản 145 là `POST /api/v1/courses/{course_id}/claim` và `POST /api/v1/courses/{course_id}/unclaim`. Audit lập chỉ mục toàn bộ method, tham số, khai báo security và response schema. Trong 54 GET có 26 route trả HTTP 200, 2 trả 403, 1 trả 404 và 25 route chưa có mẫu an toàn hoặc định danh hợp lệ. 93 operations còn lại được kiểm kê theo contract.
- JSON audit lưu tên trường, kiểu dữ liệu, số lượng bản ghi ở mẫu và mã HTTP. Các response schema rỗng hoặc thiếu chi tiết được bổ sung bằng cấu trúc payload quan sát được. [Kiểm kê OpenAPI và bằng chứng API/Web](../reports/mis-data-access-audit.json)

## Dữ liệu và mức độ đầy đủ

Các đường dẫn REST dưới đây có tiền tố `/api/v1`. Ký hiệu `P` là `/projects/{project_id}` và `T` là `P/tasks/{task_id}`. Tất cả đường dẫn trong bảng dùng GET.

| Dữ liệu | Endpoint | Quyền và bằng chứng | Giới hạn |
| --- | --- | --- | --- |
| Tài khoản, TLU, tra cứu người dùng | `/auth/me`, `/auth/tlu/status`, `/users/lookup?email=…` | **PASS** với phiên hiện tại, tra cứu email của chính tài khoản trả 200 | Tra cứu theo email cụ thể. Lịch sử job đồng bộ TLU chưa có ID phù hợp |
| Dự án và vai trò | `/projects/`, `P`, `P/members` | **PASS** trong các dự án quan sát được. Danh sách hỗ trợ `course_id`, chi tiết có trạng thái, ngày bắt đầu và deadline | Vai trò hiện tại. Chưa xác minh lịch sử thành viên hoặc quyền theo role khác |
| Task, subtask, người phụ trách, deadline | `P/tasks/`, `P/tasks/claimable`, `T` | **PASS**. `parent_id` thể hiện quan hệ cha con, `assignees` và `assignee_id` là người phụ trách hiện tại | API danh sách công bố bộ lọc `status`, chưa có tham số phân trang hoặc ngày/user. Task REST thiếu mốc tạo và hoàn thành |
| Checklist | `T.checklists`, system log trong `T.comments` | **PASS** với trạng thái, giờ và `completed_by_id`. Tìm thấy 803 log đánh dấu hoàn thành hoặc bỏ hoàn thành | Object checklist thiếu thời điểm hoàn thành. Log cho thời điểm và actor theo câu chữ. Không có khóa checklist trên log để nối chính xác mọi lần đổi |
| Comment, report, file minh chứng | `T.comments`, `T.reports`, `T/reports/{report_id}/view-log`, `T/reports/{report_id}/download` | **PASS** trên mẫu. Comment và report có tác giả, thời điểm tạo. Report có link hoặc metadata file khi được cung cấp. Log trả JSON, download trả HTTP 200 với binary | Audit xác nhận route binary bằng response headers. Link ngoài và nội dung file chỉ có theo từng bản ghi. Timestamp report là giờ gửi report |
| Lịch sử trạng thái và review | System log trong `T.comments`, `P/feed` | **PARTIAL** theo độ đầy đủ. Có 379 log chuyển trạng thái, gồm 33 `INTERNAL_REVIEW`, 99 `MENTOR_REVIEW` và 146 `DONE`. Actor trong task comment có ID | Log có trạng thái đích và thời điểm. Chưa tìm thấy sổ duyệt chính thức, trạng thái trước mỗi lần đổi hoặc lịch sử có thể phát lại đầy đủ |
| Người giao việc | System log trong `T.comments` | **PARTIAL**. Có 5 log khớp mẫu giao việc hoặc thay đổi người phụ trách | Actor là người thao tác ở sự kiện đó. Task không có trường người giao ban đầu. Log có thể chỉ mang tên người nhận bằng văn bản |
| Hoạt động dự án và người dùng | `P/feed` và comment, report, log đính kèm task | **PARTIAL**. Feed mẫu trả 50 dòng, cả 50 ID khớp task comment. Feed cookie Web và REST Bearer trả cùng các ID | Feed không công bố tham số trang và mẫu thiếu actor ID. Tên hiển thị một mình không đủ để xác nhận danh tính. Dữ liệu task đã ẩn hoặc đã xóa chưa được kiểm chứng |
| KPI và mốc theo người thực hiện | `/projects/analytics/performance` | **PASS** với payload Performance. Có bộ lọc `project_id`, `student_id`, `date_from`, `date_to`. `students[].task_details[]` có `created_at_iso` và các chuỗi mốc nhận, xem lần đầu, hoàn thành | Chỉ có mốc của task xuất hiện trong nhóm kết quả mà Performance trả. Mẫu review E2E trả 0 dòng milestone cho task đã chọn. Mốc Performance không chứa actor duyệt |
| Tài liệu dự án | `P/documents/`, `P/documents/{document_id}`, `/project-documents/{document_id}/file` | **PASS** ở dự án có mẫu. Danh sách, chi tiết và response headers file đều 200 | Phụ thuộc dự án và attachment. Audit chưa đọc toàn bộ byte file |
| LMS, roster, nhóm, bài tập, bài nộp và điểm | `/courses`, `/courses/{course_id}/students`, `/roster`, `/groups`, `/assignments`, `/assignments/{assignment_id}/submissions`, `/submissions/{submission_id}/grading`, `/analytics/courses/{course_id}/overview` | **PARTIAL**. `/courses` trả 200 với mảng rỗng. Các route con này chỉ có bằng chứng OpenAPI trong lượt audit | Chưa có lớp học phần qua danh sách của tài khoản để kiểm thử roster, deadline bài tập, chấm điểm, bài nộp, hồ sơ nhóm và analytics lớp |
| Gallery video và tài liệu LMS | `/gallery/videos`, `/gallery/videos/pending`, `/gallery/documents`, `/documents/{document_id}`, `/documents/{document_id}/file` | **PASS** ở danh sách và mẫu tài liệu. Gallery trả `items/page/page_size/total`. Một slug từ danh sách trả 404 ở `/gallery/videos/{slug}` | Chi tiết video **PARTIAL**. Chưa xác định nguyên nhân 404 cho slug mẫu |
| Queue quản trị | `/admin/queue/overview`, `/admin/queue/jobs` | **BLOCKED** với HTTP 403 trên phiên `instructor` | Chưa xác minh payload cho role quản trị |

## Đối chiếu Web và REST

Web dùng cookie phiên và HTML render từ server. Các trang `/dashboard`, `/courses`, `/gallery`, `/projects/`, `/projects/performance`, cùng trang dự án và deep link task đều trả 200 khi có phiên. Mã trang dự án tham chiếu REST cho bảng task, chi tiết task, thành viên, tài liệu, feed và file report. Mã trang Performance gọi endpoint analytics trong bảng. Khi không có phiên, trang `/projects/` trả 307 và REST `/api/v1/projects/` trả 500 trong lượt thử.

`/browse-open` xác nhận tab Chrome `-agis` trên cổng `4444`. DOM trang danh sách hiển thị 7 dự án và 4 task đang review. Ở dự án mẫu, DOM hiển thị 14 task, 12 hoàn thành và 4 thành viên, khớp REST. DOM cũng hiển thị task cha con, deadline, tỷ lệ checklist và nội dung log chuyển sang `DONE`. REST list và detail của task mẫu khớp trạng thái, cha, deadline, assignee, checklist, comment và report. Audit mới xác nhận panel chi tiết qua HTML và REST.

Mã Web tham chiếu `/api/ai-digest` ngoài OpenAPI. Các chuỗi route như `/documents/task-context/explain` cũng xuất hiện dưới dạng URL cụ thể trong frontend. Không có bằng chứng rằng các route đó cung cấp thêm lịch sử task bằng GET. Audit ghi lại các tham chiếu Web và tiếp tục dùng API có quyền để đọc dữ liệu. [Các trường `ui`, `comparisons` và `observations`](../reports/mis-data-access-audit.json)

## Gap trước và sau

| Trước | Sau |
| --- | --- |
| `mis_query_my_tasks` chỉ có một ngày và gắn thời gian claim với người phụ trách hiện tại trong bằng chứng công việc | Thêm khoảng ngày, nhóm review và phân trang theo nhóm task. Claim có nhóm riêng và actor rỗng. Tổng số giữ nguyên khi trang bị giới hạn |
| Khoảng ngày của user logs dùng biên ngày UTC. Checklist có thể mượn thời gian cập nhật task. Feed có thể khớp theo tên hiển thị | `mis_get_user_logs` dùng biên `+07:00`, hỗ trợ timeline theo dự án, tất cả actor, preview gọn và offset. Loại checklist thiếu mốc khỏi truy vấn theo ngày. Kiểu khớp tên của chế độ cũ được đánh dấu suy luận |
| Tra cứu task theo tên hoặc task cha cần đọc toàn bộ payload lồng nhau | `mis_list_tasks` có chế độ `compact`, lọc title, assignee, task cha và phân trang. `status` được gửi lên REST. Các bộ lọc còn lại và phân trang áp dụng phía MCP vì REST chưa công bố các tham số này |
| Review, giao việc và hoàn thành checklist nằm lẫn trong comment và feed | `mis_get_task` có `view=history` để lấy log đã nhận diện, actor, thời điểm, source ID và trang theo khoảng ngày. Chế độ mặc định trả chi tiết đầy đủ |
| Performance trả toàn bộ kết quả theo bộ lọc | `mis_get_project_performance` thêm `summary_only` và truy xuất milestone theo `task_id`. Server nhận lọc project, student và ngày. MCP giới hạn phần trả về theo task |
| Tool Gallery video mặc định chỉ đọc danh sách chính. Đọc tài liệu LMS theo ID cần gọi REST trực tiếp | `mis_list_gallery_videos` hỗ trợ `pending` với phân trang REST. `mis_get_document` hỗ trợ `scope=course` |
| Check-in có playbook. Câu hỏi tuần, dự án và review chưa có hướng dẫn trong MCP handshake | Server trả `instructions` và cập nhật mô tả tool để host chọn tool từ câu hỏi tiếng Việt. Registry vẫn có 49 tools |

## Đọc đúng các mốc

- **Hiện trạng** gồm status, assignee, deadline, cha/con và checklist tại thời điểm đọc.
- **Sự kiện** gồm comment, nộp report và system log. `DONE` được tính theo system log nêu rõ đích `DONE`. Tổng theo người phụ trách sử dụng nhóm task họ đang phụ trách và giữ nguyên actor trên log.
- **Suy luận** gồm attribution bằng tên hiển thị ở chế độ cũ. Câu hỏi về ai giao hoặc ai duyệt cần ít nhất log đích danh người thao tác. Actor chuyển `DONE` chỉ chứng minh người đã chuyển trạng thái. Deadline là lịch dự kiến. Số báo cáo, bình luận hoặc checklist đã đánh dấu không chứng minh task hoàn thành.

## E2E read-only

Chạy `npm.cmd run test:live-readonly`. Bộ kiểm thử đưa sáu câu hỏi mẫu vào các kịch bản ánh xạ tool và gọi MCP qua stdio với MIS live. Lượt này xác minh routing trong kịch bản, hợp đồng MCP, API và dữ liệu trả về. Host Antigravity/Codex tự chọn tool từ prompt tự do vẫn **NOT_TESTED**.

| Câu hỏi | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Hôm nay có task nào cần làm? | **PASS** | 20/11/2026, 7 dự án, 0 `TODO/IN_PROGRESS`, 4 đang review và 0 task đến hạn |
| Hôm qua đã làm và hoàn thành task nào? | **PARTIAL** | 19/11/2026, 2 task có hoạt động mang ID người dùng. 3 task trong nhóm đang phụ trách có log `DONE` |
| Tiến độ từ đầu tuần tới hôm nay? | **PARTIAL** | 16–20/11/2026, 11 task có hoạt động, 11 task trong nhóm đang phụ trách có log `DONE`, 12 task có log liên quan review hoặc `DONE` |
| Dự án có hoạt động gì gần đây? | **PARTIAL** | 265 dòng quan sát được. Hai trang liên tiếp không lặp ID nguồn. Dòng feed có thể chỉ có tên hiển thị |
| Chi tiết task có checklist, comment và báo cáo gì? | **PASS** | Mẫu có 7 checklist, 20 comment và 3 report. Kết quả REST list, detail và MCP khớp |
| Ai đưa task vào review và khi nào? | **PARTIAL** | 9 chuyển trạng thái và 9 actor ID có thể đối chiếu theo source ID. Cùng mẫu có 7 log đánh dấu checklist, 0 log giao việc và 0 dòng milestone từ Performance |

[Kết quả E2E và timestamp chạy](../reports/mis-data-access-e2e.json)
