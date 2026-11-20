# Matrix AI EDU (`mis.oanhcuongdo.com`) — OpenAPI Reference

- **OpenAPI Title**: Matrix AI EDU API (`v0.1.0`)
- **OpenAPI Version**: `3.1.0`
- **Source**: `https://mis.oanhcuongdo.com/openapi.json` (Swagger UI: `/docs`, ReDoc: `/redoc`)
- **Total Endpoints**: 147 | **Total Schemas**: 135 (live inventory on 2026-11-20)
- **Authentication**:
  - **Header**: `Authorization: Bearer <JWT>` (verified `200 OK` on `GET /api/v1/auth/me` & `GET /api/v1/projects/{id}`)
  - **Cookie**: `Cookie: access_token=<JWT>` (`httpOnly: true`, `SameSite: Lax`, `path: /`)
  - **JWT Claims**: `sub, student_code, role, token_type, iat, exp`
  - **Optional Client Geo Headers** (injected by frontend `fetch` wrapper on `/api/*`): `X-Client-Geo-Lat`, `X-Client-Geo-Lon`, `X-Client-Geo-Accuracy`

## Tag: `health` (1)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Health | - | - |

## Tag: `authentication` (9)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/auth/google/login` | Login With Google | `return_to` (query) | - |
| `GET` | `/api/v1/auth/google/callback` | Google Callback | `code` (query), `state` (query), `error` (query) | - |
| `GET` | `/api/v1/auth/me` | Current Identity | - | - |
| `POST` | `/api/v1/auth/logout` | Logout | - | - |
| `GET` | `/api/v1/auth/tlu/status` | Tlu Link Status | - | - |
| `PUT` | `/api/v1/auth/tlu/link` | Link Tlu Account | - | `application/json`: TLULinkRequest { username*: string, password*: string } |
| `POST` | `/api/v1/auth/tlu/link` | Link Tlu Account | - | `application/json`: TLULinkRequest { username*: string, password*: string } |
| `DELETE` | `/api/v1/auth/tlu/link` | Unlink Tlu Account | - | - |
| `POST` | `/api/v1/auth/tlu/login` | Legacy Login With Tlu | - | `application/json`: TLULoginRequest { username*: string, password*: string, turnstile_token*: string } |

## Tag: `courses` (2)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/courses` | Get Courses | `semester` (query) | - |
| `GET` | `/api/v1/courses/{course_id}/students` | Get Course Students | `course_id` (path*) | - |

## Tag: `course-management` (23)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/courses` | Create Course | - | `application/json`: CourseCreateRequest { course_name*: string, course_code*: string, class_code: string\|null, semester: string\|null, semester_id: string\|null, description: string\|null, join_policy: CourseJoinPolicy, join_enabled: boolean, instructor_id: string\|null } |
| `PATCH` | `/api/v1/courses/{course_id}` | Update Course | `course_id` (path*) | `application/json`: CourseUpdateRequest { course_name: string\|null, course_code: string\|null, class_code: string\|null, semester: string\|null, semester_id: string\|null, description: string\|null, join_policy: CourseJoinPolicy\|null, join_enabled: boolean\|null } |
| `POST` | `/api/v1/courses/{course_id}/archive` | Archive Course | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/hide` | Hide Course | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/unhide` | Unhide Course | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/reopen` | Reopen Course | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/join-code/regenerate` | Regenerate Join Code | `course_id` (path*) | - |
| `DELETE` | `/api/v1/courses/{course_id}/join-code` | Revoke Join Code | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/invites` | Create Invite | `course_id` (path*) | - |
| `DELETE` | `/api/v1/courses/{course_id}/invites` | Revoke Invites | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/join` | Join Course | - | `application/json`: JoinCodeRequest { code*: string } |
| `POST` | `/api/v1/courses/{course_id}/claim` | Claim Course | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/unclaim` | Unclaim Course | `course_id` (path*) | - |
| `GET` | `/api/v1/courses/{course_id}/roster` | Get Roster | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/roster` | Manual Enroll | `course_id` (path*) | `application/json`: ManualEnrollmentRequest { user_id*: string } |
| `POST` | `/api/v1/enrollments/{enrollment_id}/approve` | Approve Enrollment | `enrollment_id` (path*) | - |
| `POST` | `/api/v1/enrollments/{enrollment_id}/reject` | Reject Enrollment | `enrollment_id` (path*) | - |
| `DELETE` | `/api/v1/enrollments/{enrollment_id}` | Remove Enrollment | `enrollment_id` (path*) | - |
| `GET` | `/api/v1/courses/{course_id}/inactive-enrollments` | Get Inactive Enrollments | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/enrollments/bulk-remove` | Bulk Remove Enrollment | `course_id` (path*) | `application/json`: BulkRemoveEnrollmentRequest { enrollment_ids*: array } |
| `POST` | `/api/v1/courses/{course_id}/roster/bulk` | Bulk Manual Enroll | `course_id` (path*) | `application/json`: BulkManualEnrollmentRequest { user_ids*: array } |
| `POST` | `/api/v1/courses/{course_id}/staff/ta` | Assign Ta | `course_id` (path*) | `application/json`: CourseStaffRequest { user_id*: string } |
| `DELETE` | `/api/v1/courses/{course_id}/staff/ta/{user_id}` | Remove Ta | `course_id` (path*), `user_id` (path*) | - |

## Tag: `course-documents` (11)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/gallery/documents` | Gallery Documents | `course_id` (query), `semester` (query), `search` (query), `page` (query) | - |
| `POST` | `/api/v1/documents/{document_id}/file` | Upload Document File | `document_id` (path*) | `multipart/form-data`: Body_upload_document_file_api_v1_documents__document_id__file_post { file*: string } |
| `GET` | `/api/v1/documents/{document_id}/file` | Download Document File | `document_id` (path*) | - |
| `GET` | `/api/v1/courses/{course_id}/documents` | Get Course Documents | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/documents` | Create Course Document | `course_id` (path*) | `application/json`: CourseDocumentCreate { title*: string, description: string\|null, display_order: integer, status: CourseDocumentStatus } |
| `POST` | `/api/v1/courses/{course_id}/documents/form-chunked` | Create Course Document Form Chunked | `course_id` (path*) | `multipart/form-data`: Body_create_course_document_form_chunked_api_v1_courses__course_id__documents_form_chunked_post { upload_id*: string, chunk_index*: integer, total_chunks*: integer, title: string, description: string, status: string, display_order: integer, file*: string } |
| `POST` | `/api/v1/courses/{course_id}/documents/form` | Create Course Document Form | `course_id` (path*) | `multipart/form-data`: Body_create_course_document_form_api_v1_courses__course_id__documents_form_post { title*: string, description: string, status*: string, display_order*: integer, file: string\|null } |
| `GET` | `/api/v1/documents/{document_id}` | Get Course Document | `document_id` (path*) | - |
| `PATCH` | `/api/v1/documents/{document_id}` | Patch Course Document | `document_id` (path*) | `application/json`: CourseDocumentPatch { title: string\|null, description: string\|null, display_order: integer\|null, status: CourseDocumentStatus\|null } |
| `PUT` | `/api/v1/documents/{document_id}` | Update Document Form | `document_id` (path*) | `multipart/form-data`: Body_update_document_form_api_v1_documents__document_id__put { title*: string, description: string, status*: string, display_order*: integer, file: string\|null } |
| `DELETE` | `/api/v1/documents/{document_id}` | Delete Course Document | `document_id` (path*) | - |

## Tag: `groups` (12)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/courses/{course_id}/groups` | Get Course Groups | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/groups` | Create Course Group | `course_id` (path*) | `application/json`: ManualGroupCreateRequest { group_name: string\|null, project_topic: string\|null, topic_description: string\|null, member_user_ids: array } |
| `GET` | `/api/v1/courses/{course_id}/groups/export-roster` | Export Grouping Roster | `course_id` (path*) | - |
| `GET` | `/api/v1/courses/{course_id}/groups/export-results` | Export Grouping Results | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/groups/auto-divide` | Auto Divide Course Groups | `course_id` (path*) | `application/json`: AutoDivideRequest { mode*: GroupDivisionMode } |
| `POST` | `/api/v1/groups/{group_id}/members` | Add Course Group Member | `group_id` (path*) | `application/json`: GroupMemberMutationRequest { user_id*: string } |
| `DELETE` | `/api/v1/groups/{group_id}/members/{user_id}` | Remove Course Group Member | `group_id` (path*), `user_id` (path*) | - |
| `PUT` | `/api/v1/groups/{group_id}` | Update Group | `group_id` (path*) | `application/json`: GroupUpdateRequest { group_name: string\|null, project_topic: string\|null, topic_description: string\|null } |
| `PUT` | `/api/v1/groups/{group_id}/leader` | Transfer Group Leader | `group_id` (path*) | `application/json`: LeaderUpdateRequest { user_id*: string } |
| `POST` | `/api/v1/courses/{course_id}/groups/lock` | Lock Course Groups | `course_id` (path*) | `application/json`: GroupLockRequest { locked*: boolean } |
| `POST` | `/api/v1/courses/{course_id}/groups/move-member` | Move Course Group Member | `course_id` (path*) | `application/json`: MoveMemberRequest { user_id*: string, target_group_id*: string } |
| `POST` | `/api/v1/courses/{course_id}/groups/reconcile-dropped` | Reconcile Dropped Group Members | `course_id` (path*) | - |

## Tag: `group-profile` (3)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/courses/{course_id}/group-profile` | Get Group Profile | `course_id` (path*), `force_refresh` (query) | - |
| `PUT` | `/api/v1/courses/{course_id}/group-profile` | Put Group Profile | `course_id` (path*) | `application/json`: GroupProfileUpdate { goal*: GroupGoal, strengths*: array, preferred_role*: PreferredGroupRole, practice_shift: string\|null } |
| `POST` | `/api/v1/courses/{course_id}/group-profile/sync` | Sync Group Profile Tlu | `course_id` (path*) | - |

## Tag: `admin-users` (1)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `DELETE` | `/api/v1/admin/users/{user_id}/hard` | Hard Delete User | `user_id` (path*) | - |

## Tag: `TLU synchronization` (2)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/sync/tlu/trigger` | Trigger Tlu Sync | - | - |
| `GET` | `/api/v1/sync/tlu/status/{task_id}` | Get Tlu Sync Status | `task_id` (path*) | - |

## Tag: `assignments` (6)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/courses/{course_id}/assignments` | Get Course Assignments | `course_id` (path*) | - |
| `POST` | `/api/v1/courses/{course_id}/assignments` | Create Course Assignment | `course_id` (path*) | `application/json`: AssignmentCreate { title*: string, document_id: string\|null, checklist_items: array, description: string\|null, deadline: string\|null, max_attempts: integer, is_group_assignment: boolean, grace_period_minutes: integer, allow_late_submission: boolean, max_file_size_bytes: integer, allowed_file_types: array\|null } |
| `GET` | `/api/v1/assignments/{assignment_id}` | Get Assignment | `assignment_id` (path*) | - |
| `PATCH` | `/api/v1/assignments/{assignment_id}` | Patch Assignment | `assignment_id` (path*) | `application/json`: AssignmentPatch { title: string\|null, document_id: string\|null, checklist_items: array, description: string\|null, deadline: string\|null, max_attempts: integer\|null, is_group_assignment: boolean\|null, grace_period_minutes: integer\|null, allow_late_submission: boolean\|null, max_file_size_bytes: integer\|null, allowed_file_types: array\|null } |
| `DELETE` | `/api/v1/assignments/{assignment_id}` | Delete Assignment | `assignment_id` (path*) | - |
| `POST` | `/api/v1/assignments/{assignment_id}/extend-deadline` | Extend Assignment Deadline | `assignment_id` (path*) | `application/json`: AssignmentDeadlineExtension { new_deadline*: string } |

## Tag: `submissions` (10)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/assignments/{assignment_id}/submit/preflight` | Preflight Assignment Video | `assignment_id` (path*) | `application/json`: SubmissionPreflightRequest { file_name*: string, file_size_bytes*: integer, declared_mime_type: string\|null } |
| `POST` | `/api/v1/assignments/{assignment_id}/submit` | Submit Assignment Video | `assignment_id` (path*) | `multipart/form-data`: Body_submit_assignment_video_api_v1_assignments__assignment_id__submit_post { file*: string, title*: string, description*: string, turnstile_token: string\|null } |
| `POST` | `/api/v1/assignments/{assignment_id}/submissions/chunked` | Submit Assignment Video Chunked | `assignment_id` (path*) | `multipart/form-data`: Body_submit_assignment_video_chunked_api_v1_assignments__assignment_id__submissions_chunked_post { file*: string, title*: string, description*: string, upload_id*: string, chunk_index*: integer, total_chunks*: integer, turnstile_token: string\|null } |
| `GET` | `/api/v1/submissions/{submission_id}/status` | Get Submission Status | `submission_id` (path*) | - |
| `GET` | `/api/v1/submissions/{submission_id}/grading` | Get Submission Grading | `submission_id` (path*) | - |
| `PUT` | `/api/v1/submissions/{submission_id}/grading` | Put Submission Grading | `submission_id` (path*) | `application/json`: SubmissionGradingUpdate { grade: number\|string\|null, comment: string\|null } |
| `GET` | `/api/v1/submissions/{submission_id}/stream` | Stream Submission Video | `submission_id` (path*) | - |
| `GET` | `/api/v1/assignments/{assignment_id}/submissions` | Get Assignment Submissions | `assignment_id` (path*), `page` (query), `page_size` (query) | - |
| `GET` | `/api/v1/assignments/{assignment_id}/quick-report` | Quick Assignment Report | `assignment_id` (path*) | - |
| `GET` | `/api/v1/courses/{course_id}/task-summary` | Get Course Task Summary Api | `course_id` (path*) | - |

## Tag: `youtube-queue` (4)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/admin/queue/overview` | Get Queue Overview | - | - |
| `GET` | `/api/v1/admin/queue/jobs` | Get Queue Jobs | `page` (query), `page_size` (query) | - |
| `POST` | `/api/v1/admin/queue/{submission_id}/retry` | Retry Queue Job | `submission_id` (path*) | - |
| `POST` | `/api/v1/admin/queue/{submission_id}/priority` | Prioritize Queue Job | `submission_id` (path*) | - |

## Tag: `gallery` (5)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/gallery/videos` | Get Gallery Videos | `course_id` (query), `semester` (query), `search` (query), `filter` (query), `sort_by` (query), `page` (query), `page_size` (query) | - |
| `GET` | `/api/v1/gallery/videos/pending` | Get Pending Gallery Videos | `course_id` (query), `semester` (query), `search` (query), `page` (query), `page_size` (query) | - |
| `GET` | `/api/v1/gallery/videos/{slug}` | Get Gallery Video | `slug` (path*) | - |
| `PATCH` | `/api/v1/gallery/videos/{submission_id}/featured` | Patch Featured Video | `submission_id` (path*) | `application/json`: FeaturedUpdate { is_featured*: boolean } |
| `POST` | `/api/v1/gallery/videos/{slug}/view` | Count Video View | `slug` (path*) | - |

## Tag: `analytics` (3)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/analytics/courses/{course_id}/overview` | Get Course Analytics | `course_id` (path*) | - |
| `GET` | `/api/v1/analytics/courses/{course_id}/leaderboard` | Get Course Leaderboard Route | `course_id` (path*) | - |
| `GET` | `/api/v1/analytics/assignments/{assignment_id}/export` | Export Assignment | `assignment_id` (path*) | - |

## Tag: `ai` (1)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/ai/suggest-task` | Suggest Task | - | `application/json`: SuggestTaskRequest { idea*: string } |

## Tag: `projects` (17)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/projects/` | Create Project | - | `application/json`: ProjectCreate { name*: string, description: string\|null, course_id: string\|null, start_date: string\|null, deadline: string\|null } |
| `GET` | `/api/v1/projects/` | Get Projects | `course_id` (query) | - |
| `GET` | `/api/v1/projects/analytics/performance` | Get Project Performance Analytics | `project_id` (query), `student_id` (query), `date_from` (query), `date_to` (query) | - |
| `POST` | `/api/v1/projects/analytics/adjustments/task-exemption` | Set Task Exemption Api | - | `application/json`: TaskExemptionRequest { task_id*: string, user_id*: string, is_exempt: boolean, reason: string\|null } |
| `POST` | `/api/v1/projects/analytics/adjustments/student-score` | Set Student Score Adjustment Api | - | `application/json`: StudentScoreAdjustmentRequest { user_id*: string, project_id: string\|null, score_delta: number, override_score: number\|null, reason: string\|null } |
| `GET` | `/api/v1/projects/{project_id}` | Get Project | `project_id` (path*) | - |
| `PATCH` | `/api/v1/projects/{project_id}` | Update Project | `project_id` (path*) | `application/json`: ProjectUpdate { name: string\|null, description: string\|null, status: string\|null, start_date: string\|null, deadline: string\|null } |
| `DELETE` | `/api/v1/projects/{project_id}` | Delete Project | `project_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/members` | Add Member | `project_id` (path*) | `application/json`: MemberAdd { user_id*: string, role: string } |
| `GET` | `/api/v1/projects/{project_id}/members` | Get Members | `project_id` (path*) | - |
| `DELETE` | `/api/v1/projects/{project_id}/members/{user_id}` | Remove Member | `project_id` (path*), `user_id` (path*) | - |
| `GET` | `/api/v1/projects/{project_id}/feed` | Get Project Feed Api | `project_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/comments` | Add Project Comment Api | `project_id` (path*) | `application/json`: ProjectCommentCreate { content*: string } |
| `GET` | `/api/v1/projects/{project_id}/ai-summary` | Ai Summarize Project Api | `project_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/invite` | Generate Invite Link | `project_id` (path*) | - |
| `DELETE` | `/api/v1/projects/{project_id}/invite` | Revoke Invite Link | `project_id` (path*) | - |
| `POST` | `/api/v1/projects/join-by-token/{token}` | Join Project By Token | `token` (path*) | - |

## Tag: `project-tasks` (20)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/projects/{project_id}/tasks/` | Create Task | `project_id` (path*) | `application/json`: TaskCreate { title*: string, description: string\|null, assignee_id: string\|null, assignee_ids: array\|null, deadline: string\|null, parent_id: string\|null, estimated_hours: number\|null, is_claimable: boolean\|null } |
| `GET` | `/api/v1/projects/{project_id}/tasks/` | Get Tasks | `project_id` (path*), `status` (query) | - |
| `GET` | `/api/v1/projects/{project_id}/tasks/claimable` | Get Claimable Tasks Endpoint | `project_id` (path*) | - |
| `GET` | `/api/v1/projects/{project_id}/tasks/{task_id}` | Get Task | `project_id` (path*), `task_id` (path*) | - |
| `PATCH` | `/api/v1/projects/{project_id}/tasks/{task_id}` | Update Task | `project_id` (path*), `task_id` (path*) | `application/json`: TaskUpdate { title: string\|null, description: string\|null, status: string\|null, assignee_id: string\|null, assignee_ids: array\|null, deadline: string\|null, report_text: string\|null, report_link_url: string\|null, parent_id: string\|null, estimated_hours: number\|null, actual_hours: number\|null, is_claimable: boolean\|null } |
| `DELETE` | `/api/v1/projects/{project_id}/tasks/{task_id}` | Delete Task | `project_id` (path*), `task_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/claim` | Claim Task | `project_id` (path*), `task_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/release` | Release Task | `project_id` (path*), `task_id` (path*) | `application/json`: {"anyOf":[{"$ref":"#/components/schemas/TaskReleaseBody"},{"type":"null"}],"title":"Body"} |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/reports` | Submit Task Report | `project_id` (path*), `task_id` (path*) | `multipart/form-data`: Body_submit_task_report_api_v1_projects__project_id__tasks__task_id__reports_post { report_text: string\|null, report_link_url: string\|null, file: string\|null } |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/upload-report` | Upload Task Report | `project_id` (path*), `task_id` (path*) | `multipart/form-data`: Body_upload_task_report_api_v1_projects__project_id__tasks__task_id__upload_report_post { file*: string } |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/upload-report-chunked` | Upload Task Report Chunked | `project_id` (path*), `task_id` (path*) | `multipart/form-data`: Body_upload_task_report_chunked_api_v1_projects__project_id__tasks__task_id__upload_report_chunked_post { upload_id*: string, chunk_index*: integer, total_chunks*: integer, file*: string, original_filename: string\|null, report_text: string\|null, report_link_url: string\|null } |
| `GET` | `/api/v1/projects/{project_id}/tasks/{task_id}/reports/{report_id}/download` | Download Task Report File | `project_id` (path*), `task_id` (path*), `report_id` (path*) | - |
| `GET` | `/api/v1/projects/{project_id}/tasks/{task_id}/download-file` | Download Task File By Url | `project_id` (path*), `task_id` (path*), `file_url` (query*), `file_name` (query) | - |
| `GET` | `/api/v1/projects/{project_id}/tasks/{task_id}/reports/{report_id}/view-log` | View Task Report Log | `project_id` (path*), `task_id` (path*), `report_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/checklists` | Add Checklist | `project_id` (path*), `task_id` (path*) | `application/json`: ChecklistCreate { title*: string, estimated_hours: number\|null } |
| `PATCH` | `/api/v1/projects/{project_id}/tasks/{task_id}/checklists/{checklist_id}/title` | Rename Checklist | `project_id` (path*), `task_id` (path*), `checklist_id` (path*) | `application/json`: ChecklistUpdate { title*: string } |
| `DELETE` | `/api/v1/projects/{project_id}/tasks/{task_id}/checklists/{checklist_id}` | Delete Checklist | `project_id` (path*), `task_id` (path*), `checklist_id` (path*) | - |
| `PATCH` | `/api/v1/projects/{project_id}/tasks/{task_id}/checklists/{checklist_id}` | Toggle Checklist | `project_id` (path*), `task_id` (path*), `checklist_id` (path*) | `application/json`: ChecklistToggle { is_completed*: boolean, actual_hours: number\|null } |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/comments` | Add Comment | `project_id` (path*), `task_id` (path*) | `application/json`: CommentCreate { content*: string } |
| `POST` | `/api/v1/projects/{project_id}/tasks/{task_id}/generate-checklist` | Generate Checklist | `project_id` (path*), `task_id` (path*) | - |

## Tag: `project-documents` (11)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/projects/{project_id}/documents/` | Create Document | `project_id` (path*) | `application/json`: DocumentCreate { title*: string, content: string\|null } |
| `GET` | `/api/v1/projects/{project_id}/documents/` | Get Documents | `project_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/documents/upload-chunked` | Upload Document Chunked | `project_id` (path*) | `multipart/form-data`: Body_upload_document_chunked_api_v1_projects__project_id__documents_upload_chunked_post { upload_id*: string, chunk_index*: integer, total_chunks*: integer, title: string, content: string\|null, file*: string } |
| `POST` | `/api/v1/projects/{project_id}/documents/upload` | Upload Document | `project_id` (path*) | `multipart/form-data`: Body_upload_document_api_v1_projects__project_id__documents_upload_post { title*: string, content: string\|null, file*: string } |
| `GET` | `/api/v1/projects/{project_id}/documents/{document_id}` | Get Document | `project_id` (path*), `document_id` (path*) | - |
| `PATCH` | `/api/v1/projects/{project_id}/documents/{document_id}` | Update Document | `project_id` (path*), `document_id` (path*) | `application/json`: DocumentUpdate { title: string\|null, content: string\|null } |
| `DELETE` | `/api/v1/projects/{project_id}/documents/{document_id}` | Delete Document | `project_id` (path*), `document_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/documents/{document_id}/explain` | Explain Text | `project_id` (path*), `document_id` (path*) | `application/json`: ExplainRequest { highlighted_text*: string, context_window: string\|null } |
| `POST` | `/api/v1/projects/{project_id}/documents/{document_id}/summarize` | Summarize Document Api | `project_id` (path*), `document_id` (path*) | - |
| `POST` | `/api/v1/projects/{project_id}/documents/{document_id}/create-task` | Create Task From Document | `project_id` (path*), `document_id` (path*) | `application/json`: TaskFromDocCreate { title*: string, description: string\|null, assignee_id: string\|null, assignee_ids: array\|null, deadline: string\|null } |
| `GET` | `/api/v1/project-documents/{document_id}/file` | Download Document File | `document_id` (path*) | - |

## Tag: `users` (1)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/users/lookup` | Lookup User By Email | `email` (query*) | - |

## Tag: `projects-ui` (5)

| Method | Path | Summary | Params | Request Body |
| --- | --- | --- | --- | --- |
| `GET` | `/projects/` | Projects List Page | - | - |
| `GET` | `/projects/performance` | Project Performance Page | `project_id` (query), `student_id` (query), `date_from` (query), `date_to` (query) | - |
| `GET` | `/projects/{project_id}` | Project Detail Page | `project_id` (path*) | - |
| `GET` | `/projects/join/{token}` | Project Invite Confirmation | `token` (path*) | - |
| `POST` | `/projects/join/{token}` | Project Invite Accept | `token` (path*) | - |

