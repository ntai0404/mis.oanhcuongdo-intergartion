import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(workspace, 'reports');
const docsDir = path.join(workspace, 'docs');
fs.mkdirSync(docsDir, { recursive: true });

const openapi = JSON.parse(fs.readFileSync(path.join(reportsDir, 'openapi.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'openapi-summary.json'), 'utf8'));
const liveUser = JSON.parse(fs.readFileSync(path.join(reportsDir, 'live-user-readonly.json'), 'utf8'));
const projectSnap = JSON.parse(fs.readFileSync(path.join(reportsDir, 'project-page-snapshot.json'), 'utf8'));

const schemas = openapi.components?.schemas || {};

function resolveSchemaFields(schemaRefOrObj) {
  if (!schemaRefOrObj) return '';
  if (typeof schemaRefOrObj === 'string' && schemaRefOrObj.startsWith('#/components/schemas/')) {
    const name = schemaRefOrObj.split('/').pop();
    const s = schemas[name];
    if (!s) return name;
    if (s.enum) return `${name} (enum: ${s.enum.join(', ')})`;
    const props = s.properties || {};
    const req = new Set(s.required || []);
    const fields = Object.entries(props).map(([k, v]) => {
      const t = v.type || (v.anyOf ? v.anyOf.map(a => a.type || a.$ref?.split('/').pop()).join('|') : v.$ref?.split('/').pop() || 'any');
      return `${k}${req.has(k) ? '*' : ''}: ${t}`;
    });
    return `${name} { ${fields.join(', ')} }`;
  }
  return JSON.stringify(schemaRefOrObj);
}

// 1. Build MIS-API-REFERENCE.md
let apiMd = `# Matrix AI EDU (\`mis.oanhcuongdo.com\`) — OpenAPI Reference\n\n`;
apiMd += `- **OpenAPI Title**: ${openapi.info?.title} (\`v${openapi.info?.version}\`)\n`;
apiMd += `- **OpenAPI Version**: \`${openapi.openapi}\`\n`;
apiMd += `- **Source**: \`https://mis.oanhcuongdo.com/openapi.json\` (Swagger UI: \`/docs\`, ReDoc: \`/redoc\`)\n`;
apiMd += `- **Total Endpoints**: ${summary.totalEndpoints} | **Total Schemas**: ${summary.schemasCount}\n`;
apiMd += `- **Authentication**:\n`;
apiMd += `  - **Header**: \`Authorization: Bearer <JWT>\` (verified \`200 OK\` on \`GET /api/v1/auth/me\` & \`GET /api/v1/projects/{id}\`)\n`;
apiMd += `  - **Cookie**: \`Cookie: access_token=<JWT>\` (\`httpOnly: true\`, \`SameSite: Lax\`, \`path: /\`)\n`;
apiMd += `  - **JWT Claims**: \`${(summary.jwtInfo ? Object.keys(summary.jwtInfo.payload) : []).join(', ')}\`\n`;
apiMd += `  - **Optional Client Geo Headers** (injected by frontend \`fetch\` wrapper on \`/api/*\`): \`X-Client-Geo-Lat\`, \`X-Client-Geo-Lon\`, \`X-Client-Geo-Accuracy\`\n\n`;

for (const [tag, ops] of Object.entries(summary.byTag)) {
  apiMd += `## Tag: \`${tag}\` (${ops.length})\n\n`;
  apiMd += `| Method | Path | Summary | Params | Request Body |\n`;
  apiMd += `| --- | --- | --- | --- | --- |\n`;
  for (const op of ops) {
    const pStr = (op.params || []).map(p => `\`${p.name}\` (${p.in}${p.required ? '*' : ''})`).join(', ') || '-';
    const rbStr = (op.requestBody || []).map(rb => `\`${rb.contentType}\`: ${resolveSchemaFields(rb.schema)}`).join('<br>') || '-';
    apiMd += `| \`${op.method}\` | \`${op.path}\` | ${op.summary || op.operationId} | ${pStr} | ${rbStr.replace(/\|/g, '\\|')} |\n`;
  }
  apiMd += `\n`;
}

fs.writeFileSync(path.join(docsDir, 'MIS-API-REFERENCE.md'), apiMd, 'utf8');

// 2. Build MIS-UI-AND-MCP-BLUEPRINT.md
let uiMd = `# Matrix AI EDU (\`mis.oanhcuongdo.com\`) — Điều tra thành phần, chức năng & Thiết kế MCP\n\n`;
uiMd += `## 1. Thông tin phiên User đã kiểm chứng (Read-only)\n\n`;
const u = liveUser.me?.body?.user || {};
uiMd += `- **User ID**: \`${u.id}\`\n`;
uiMd += `- **Họ tên**: ${u.full_name}\n`;
uiMd += `- **Email**: \`${u.email}\`\n`;
uiMd += `- **Role**: \`${u.role}\`\n`;
uiMd += `- **TLU Link Status**: \`${liveUser.me?.body?.tlu_status}\`\n`;
uiMd += `- **Projects đang tham gia**: ${Array.isArray(liveUser.projects?.body) ? liveUser.projects.body.length : 'N/A'}\n`;
if (Array.isArray(liveUser.projects?.body)) {
  for (const pr of liveUser.projects.body) {
    uiMd += `  - \`${pr.id}\` — **${pr.name}** (\`${pr.status}\`, deadline: \`${pr.deadline || '-'}\`)\n`;
  }
}
uiMd += `\n> Token Bearer đã được trích xuất chỉ đọc từ cookie \`access_token\` vào file gitignored \`.env.mis\` (tái trích xuất bất cứ lúc nào bằng tool \`mis_refresh_token_from_cdp\`; script khởi tạo ban đầu đã lưu tại \`scripts/legacy/extract-bearer-and-user.mjs\`).\n\n`;

uiMd += `## 2. Kiến trúc Web & Các trang/module UI\n\n`;
uiMd += `- **Kiến trúc**: FastAPI SSR (HTML templates + Tailwind CSS CDN + TomSelect + inline Vanilla JS gọi \`/api/v1/...\`).\n`;
uiMd += `- **Thanh điều hướng chính (Header/Nav)**:\n`;
uiMd += `  - \`/dashboard\` — **Tổng quan** (Dashboard cá nhân & danh sách lớp học phần)\n`;
uiMd += `  - \`/courses\` — **Lớp học phần** (Tham gia lớp bằng \`join_code\`, tạo lớp LMS mới)\n`;
uiMd += `  - \`/projects/\` — **Dự án học tập** (Danh sách dự án, KPI \`/projects/performance\`, trang chi tiết \`/projects/{project_id}\`)\n`;
uiMd += `  - \`/gallery\` — **Thư viện video** (Video đã upload, chờ xử lý, tài liệu học phần, trang chi tiết \`/video/{slug}\`)\n`;
uiMd += `  - \`/login\` (Google OAuth \`/api/v1/auth/google/login\` & legacy TLU login) và \`/admin\` (\`/admin/login\` cho quản trị)\n\n`;

uiMd += `### Các trang đã crawl (GET-only)\n\n`;
uiMd += `| Route | HTTP | Title | Headings chính | Số control | Số button |\n`;
uiMd += `| --- | --- | --- | --- | --- | --- |\n`;
for (const p of summary.pages) {
  if (p.status !== 200) continue;
  uiMd += `| \`${p.route}\` | ${p.status} | ${p.title || '-'} | ${(p.headings || []).slice(0, 4).join('; ').replace(/\|/g, '\\|') || '-'} | ${p.controls?.length || 0} | ${p.buttons?.length || 0} |\n`;
}
uiMd += `\n`;

uiMd += `## 3. Phân tích chi tiết trang Dự án (\`/projects/{project_id}\`)\n\n`;
uiMd += `Trang dự án là workspace làm việc chính gồm 3 tab + slide-over panel + các modal:\n\n`;
uiMd += `- **Tab 1 — Công việc (Tasks) (\`#pane-board\`)**:\n`;
uiMd += `  - Filter pills: \`Tất cả\`, \`Của tôi\`, \`✋ Việc mở\`.\n`;
uiMd += `  - Bảng Tasks (\`TÊN TASK\`, \`TRẠNG THÁI\`, \`PHỤ TRÁCH\`, \`DEADLINE\`, \`TIẾN ĐỘ\`) hỗ trợ task cha/con và kéo-thả đổi trạng thái (\`PATCH /api/v1/projects/{project_id}/tasks/{task_id}\`).\n`;
uiMd += `  - Nút \`+ Thêm Task\` mở \`#modal-create-task\` (\`POST /api/v1/projects/{project_id}/tasks/\`).\n`;
uiMd += `- **Tab 2 — Thành viên (\`#pane-members\`)**:\n`;
uiMd += `  - Bảng thành viên + Role + Task đang làm.\n`;
uiMd += `  - Thêm/xóa thành viên (\`POST/DELETE /api/v1/projects/{project_id}/members\`), modal tạo/thu hồi link mời (\`POST/DELETE /api/v1/projects/{project_id}/invite\`).\n`;
uiMd += `- **Tab 3 — Tài liệu (\`#pane-documents\`)**:\n`;
uiMd += `  - Danh sách tài liệu dự án, tải file, phân tích/tóm tắt AI, tạo task từ tài liệu (\`POST .../documents/{doc_id}/create-task\`), upload chunked (>5MB).\n`;
uiMd += `- **Sidebar Hoạt động & AI**:\n`;
uiMd += `  - Feed hoạt động (\`GET /api/v1/projects/{project_id}/feed\`), gửi comment dự án (\`POST .../comments\`), tổng hợp AI (\`GET .../ai-summary\`).\n`;
uiMd += `- **Panel Chi tiết Task (\`#task-detail-panel\`)**:\n`;
uiMd += `  - Chỉnh sửa tiêu đề, trạng thái (\`TODO\`, \`IN_PROGRESS\`, \`INTERNAL_REVIEW\`, \`MENTOR_REVIEW\`, \`DONE\` - chỉ PM/Mentor duyệt \`DONE\`), assignee, parent, deadline, estimated/actual hours, mô tả.\n`;
uiMd += `  - Nhận việc mở (\`POST .../claim\`) & trả việc (\`POST .../release\`).\n`;
uiMd += `  - Checklist (\`POST/PATCH/DELETE .../checklists\`, \`POST .../generate-checklist\`).\n`;
uiMd += `  - Nộp báo cáo kết quả & minh chứng (\`POST .../reports\` hoặc \`upload-report-chunked\`, xem log \`.../view-log\`, tải file \`.../download\`).\n`;
uiMd += `  - Comment task (\`POST .../comments\`) và Hỏi AI theo ngữ cảnh task (\`POST .../documents/task-context/explain\`).\n\n`;

uiMd += `### Controls & Inputs phát hiện trên trang Project (Read-only inventory)\n\n`;
uiMd += `| Element ID | Tag | Type / Role | Placeholder / Ghi chú |\n`;
uiMd += `| --- | --- | --- | --- |\n`;
for (const c of projectSnap.controls || []) {
  uiMd += `| \`${c.id || '-'}\` | \`${c.tag}\` | \`${c.type || c.role || '-'}\` | ${c.placeholder || '-'} |\n`;
}
uiMd += `\n`;

uiMd += `## 4. Đề xuất thiết kế MCP Server (\`mis_matrix\`) cho Agent\n\n`;
uiMd += `Tất cả gọi API đều dùng \`MIS_BASE_URL=https://mis.oanhcuongdo.com\` kèm header \`Authorization: Bearer <MIS_BEARER_TOKEN>\`.\n\n`;
uiMd += `### Nhóm Read-only Tools (an toàn gọi tự do)\n`;
uiMd += `1. \`mis_get_me\` -> \`GET /api/v1/auth/me\` (xác minh identity & role hiện tại)\n`;
uiMd += `2. \`mis_list_projects\` -> \`GET /api/v1/projects/\` (danh sách dự án)\n`;
uiMd += `3. \`mis_get_project\` -> \`GET /api/v1/projects/{project_id}\` (chi tiết dự án, thành viên, invite token)\n`;
uiMd += `4. \`mis_get_project_feed\` -> \`GET /api/v1/projects/{project_id}/feed\` (nhật ký hoạt động)\n`;
uiMd += `5. \`mis_list_tasks\` -> \`GET /api/v1/projects/{project_id}/tasks/\` (toàn bộ tasks của dự án)\n`;
uiMd += `6. \`mis_get_task\` -> \`GET /api/v1/projects/{project_id}/tasks/{task_id}\` (chi tiết task, checklists, reports, comments)\n`;
uiMd += `7. \`mis_read_task_log\` -> \`GET /api/v1/projects/{project_id}/tasks/{task_id}/reports/{report_id}/view-log\` (đọc log minh chứng)\n`;
uiMd += `8. \`mis_list_documents\` -> \`GET /api/v1/projects/{project_id}/documents/\` & đọc file/nội dung\n`;
uiMd += `9. \`mis_project_performance\` -> \`GET /api/v1/projects/performance/data\` (nếu có trong OpenAPI — xem KPI)\n`;
uiMd += `10. \`mis_list_courses\` / \`mis_get_course_roster\` / \`mis_list_assignments\` / \`mis_list_gallery\` -> các \`GET\` bên LMS/Courses/Gallery\n\n`;
uiMd += `### Nhóm Write / Mutation Tools (nên gắn xác nhận / audit rõ ràng)\n`;
uiMd += `1. \`mis_create_task\` -> \`POST /api/v1/projects/{project_id}/tasks/\`\n`;
uiMd += `2. \`mis_update_task\` -> \`PATCH /api/v1/projects/{project_id}/tasks/{task_id}\` (đổi status, hours, assignee, deadline...)\n`;
uiMd += `3. \`mis_claim_task\` / \`mis_release_task\` -> \`POST .../claim\`, \`POST .../release\`\n`;
uiMd += `4. \`mis_manage_checklist\` -> \`POST/PATCH/DELETE .../checklists/...\`\n`;
uiMd += `5. \`mis_submit_task_report\` -> \`POST .../reports\` (text, link, file multipart hoặc chunked)\n`;
uiMd += `6. \`mis_post_comment\` -> \`POST .../comments\` (task hoặc project)\n`;
uiMd += `7. \`mis_ai_summarize_project\` / \`mis_ai_ask_task\` -> \`GET .../ai-summary\`, \`POST .../documents/task-context/explain\`\n`;

fs.writeFileSync(path.join(docsDir, 'MIS-UI-AND-MCP-BLUEPRINT.md'), uiMd, 'utf8');
console.log('DOCS_GENERATED');
