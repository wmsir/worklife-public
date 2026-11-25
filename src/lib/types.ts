export interface CookieRec {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface WechatConfig {
  enabled: boolean;
  mode: "webservice" | "webhook";
  url: string;
  sys_flag: string;
  sys_id: string;
  sys_id_pass: string;
  user_type: string;
  target_erp: string;
  webhook_url: string;
  auto_notify_report: boolean;
  auto_notify_mr: boolean;
  template_report: string;
  template_mr: string;
  template_test: string;
  template_miss: string;
}

export interface WorktimeConfig {
  ip: string;
  space_id: string;
  role_name: string;
  branch_ref: string;
  branch_default_reviewers: Record<string, string>;
  wechat_config: WechatConfig;
  miss_check_members: Array<{ name: string; erp: string }>;
  branch_projects: string[];
  uat_default_handler: Record<string, unknown>;
}

export interface Settings {
  dataRoot: string;
  cookies: CookieRec[];
  worktime: WorktimeConfig;
  lastUser?: WhoamiResult | null;
  portable?: boolean;
  dataRootResolved?: string;
}

export type ProjectKind = "work" | "life";

export interface Project {
  id: string;
  name: string;
  kind: ProjectKind;
  icon: string;
  color: string;
  builtin: boolean;
  createdAt: string;
  parentId?: string | null;
  folderName?: string;
}

export interface ProjectFsEntry {
  name: string;
  relPath: string;
  isDir: boolean;
  size: number;
  modifiedAt: string;
  ext: string;
  isTextEditable: boolean;
  linkedProjectId?: string | null;
  isTaskDir?: boolean;
}

export interface ProjectFsListing {
  projectId: string;
  rootAbsPath: string;
  currentRelPath: string;
  entries: ProjectFsEntry[];
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export type RepeatRule = "none" | "daily" | "workdays" | "weekly" | "monthly";

export interface Todo {
  id: string;
  projectId: string;
  title: string;
  note: string;
  date: string | null;
  time: string | null;
  priority: 1 | 2 | 3; // 1=高, 2=中, 3=低
  done: boolean;
  taskCode: string | null;
  templateId: string | null;
  createdAt: string;
  doneAt: string | null;
  tags: string[];
  repeat: RepeatRule;
  subtasks: Subtask[];
  pomodoros: number;
  spawnedNext?: boolean;
}

export interface ToggleTodoResult {
  todo: Todo;
  spawned: Todo | null;
}

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: "daily" | "weekly";
  targetPerWeek: number;
  reminderTime: string | null;
  archived: boolean;
  createdAt: string;
  checkins: string[];
}

export interface Countdown {
  id: string;
  title: string;
  targetDate: string;
  category: string;
  annual: boolean;
  note: string;
  color: string;
  createdAt: string;
}

export interface JournalSummary {
  date: string;
  mood: number;
  energy: number;
  tags: string[];
  preview: string;
  path: string;
}

export interface JournalEntry {
  date: string;
  mood: number;
  energy: number;
  tags: string[];
  content: string;
  exists: boolean;
  path: string;
}

export type BackupMode = "mirror" | "zip";
export type BackupTargetType = "local_sync" | "webdav";

export interface BackupTask {
  id: string;
  name: string;
  sourceDir: string;
  enabled: boolean;
  mode: BackupMode;
  targetType: BackupTargetType;
  localTargetDir: string;
  webdavUrl: string;
  webdavUser: string;
  webdavPass: string;
  webdavRemoteDir: string;
  excludePatterns: string[];
  keepVersions: number;
  autoIntervalMinutes: number;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastSummary?: string | null;
}

export interface BackupRecord {
  id: string;
  taskId: string;
  taskName: string;
  startedAt: string;
  finishedAt: string;
  mode: string;
  targetType: string;
  status: string;
  filesCopied: number;
  filesSkipped: number;
  totalBytes: number;
  artifactName: string;
  message: string;
}

export interface BackupConfig {
  tasks: BackupTask[];
  history: BackupRecord[];
}

export interface BackupProgress {
  taskId: string;
  phase: string;
  current: number;
  total: number;
  currentFile: string;
}

export interface TemplateStep {
  title: string;
  offsetDays: number;
  durationDays: number;
  time: string | null;
}

export interface Template {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string;
  workdaysOnly: boolean;
  steps: TemplateStep[];
}

export interface PreviewStepItem {
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  time: string | null;
}

export interface TaskHistoryItem {
  at: string;
  event: string;
}

export type TaskStatus = "未开始" | "进行中" | "已提测" | "已发版" | "已关闭";

export interface TaskBranchRecord {
  branch: string;
  refBranch: string;
  repos: string[];
  createdAt: string;
  source: string;
}

export interface RecordTaskBranchInput {
  code: string;
  name?: string;
  branch: string;
  refBranch?: string;
  repos?: string[];
  tags?: string[];
  source?: string;
}

export interface TaskRecord {
  code: string;
  cardId: number | null;
  name: string;
  sprint: string;
  sprintStart: string;
  sprintEnd: string;
  startDate: string;
  releaseDate: string;
  planTestDate: string;
  status: TaskStatus;
  repos: string[];
  branch: string;
  branches?: TaskBranchRecord[];
  tags: string[];
  notes: string;
  folderName: string;
  createdAt: string;
  updatedAt: string;
  history: TaskHistoryItem[];
}

export interface TaskSyncItem {
  code: string;
  cardId?: number | null;
  name?: string;
  sprint?: string;
  sprintStart?: string;
  sprintEnd?: string;
  planTestDate?: string;
}

export interface TasksSyncResult {
  created: number;
  updated: number;
  tasks: TaskRecord[];
}

export interface TasksBatchReleaseResult {
  confirmed: number;
  confirmedCodes: string[];
  tasks: TaskRecord[];
}

export interface TaskWorkspaceDoc {
  key: string;
  label: string;
  category: string;
  relPath: string;
  absPath: string;
  dirAbsPath: string;
  uploadAbsPath: string;
  ext: string;
}

export interface CreateProjectTaskInput {
  projectId: string;
  parentRelPath?: string | null;
  code?: string;
  name: string;
  sprint?: string;
}

export interface WhoamiResult {
  user: {
    userErp?: string;
    erp?: string;
    name?: string;
    userName?: string;
    email?: string;
    org?: { name?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
  realName: string;
  orgName?: string;
  erp?: string;
  email?: string;
  memberCount?: number;
  syncedAt?: string;
  capacity?: {
    userName?: string;
    isQualified?: boolean;
    startMonth?: string;
    month?: string;
    cardCount?: number;
    devWorkCoefficient?: number;
    personalDeliveryCapacity?: number;
    personalDeliveryCapacityStandard?: number;
    [k: string]: unknown;
  };
}

export interface LogEntry {
  id: string;
  ts: string;
  line: string;
}

export type NoteKind = "note" | "snippet";
export type NoteArea = "work" | "life";

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  area: NoteArea;
  language: string;
  color: string;
  tags: string[];
  pinned: boolean;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TransactionKind = "expense" | "income";

export interface FinanceTransaction {
  id: string;
  date: string;
  kind: TransactionKind;
  amount: number;
  category: string;
  account: string;
  note: string;
  createdAt: string;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  category: string;
  dueDay: number;
  account: string;
  note: string;
  active: boolean;
  lastRecordedMonth?: string | null;
}

export interface FinanceData {
  monthlyBudget: number;
  transactions: FinanceTransaction[];
  recurringBills: RecurringBill[];
}

export interface WeeklyReportSummary {
  key: string;
  title: string;
  updatedAt: string;
  preview: string;
  path: string;
}

export interface CnDayInfo {
  is_workday: boolean;
  day_type: "workday" | "in_lieu" | "holiday" | "weekend";
  label: string;
  weekday_str: string;
  holiday_name?: string;
}

export type ApiParamLocation = "query" | "body" | "path" | "header" | "form";
export type ApiParamValueType = "string" | "number" | "boolean" | "json" | "file";

export interface ApiParamSpec {
  key: string;
  location: ApiParamLocation | string;
  valueType: ApiParamValueType | string;
  value: string;
  sourceKey: string;
  enabled: boolean;
  required: boolean;
  description: string;
  linkedRule: string;
}

export interface ApiEndpointRule {
  key: string;
  group: "auth" | "hours" | "git_mr" | "flow" | "tags_files" | "wechat" | string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "WEB" | string;
  pathTemplate: string;
  description: string;
  queryParamsDoc: string;
  bodyParamsDoc: string;
  placeholders: string[];
  params: ApiParamSpec[];
}

export interface RepoTagRule {
  repoKeyword: string;
  tagName: string;
  tagId: number;
  exampleProject: string;
}

export interface StatusFlowStepRule {
  id: number;
  key: string;
  name: string;
  desc: string;
}

export interface ApiParamRules {
  connectCheckTimeoutMs: number;
  requestTimeoutSecs: number;
  uploadTimeoutSecs: number;
  maxRetries: number;
  keepAliveIntervalSecs: number;
  timeWork: number;
  maxDailyHours: number;
  dynamicPreferredHours: number;
  defaultRoleCode: number;
  defaultQaRoleCode: number;
  workItemTypeCode: number;
  skipSprintId: number;
  cardPageSize: number;
  declareStatus: number;
  defaultDeclareDesc: string;
  monthlyWorkdaysFactor: number;
  defaultMemberRate: number;
  defaultReviewerId: string;
  defaultReviewerName: string;
  approveScore: number;
  mergeStrategy: string;
  autoApproveKeyword: string;
  planTestDateField: string;
  statusFlowAction: string;
  checklistPassResult: number;
  planDateTriggerStatuses: number[];
  testAuditStatusId: number;
  uatVerifyStatusId: number;
  wechatSoapNamespace: string;
  wechatWebhookPrefix: string;
  builtinReviewers: Record<string, number>;
  memberRates: Record<string, number>;
  repoToTagMapping: RepoTagRule[];
  statusFlowSteps: StatusFlowStepRule[];
}

export interface ApiConfig {
  scheme: "http" | "https" | string;
  ip: string;
  port: string;
  loginPath: string;
  spaceId: number;
  endpoints: ApiEndpointRule[];
  rules: ApiParamRules;
  updatedAt: string;
}

export interface ProbeResult {
  reachable: boolean;
  url: string;
  host: string;
  port: number;
  statusCode?: number | null;
  latencyMs: number;
  reasonKind: "ok" | "timeout" | "refused" | "offline" | "invalid_url" | "forced" | string;
  message: string;
}

export interface LoginWindowResult {
  opened: boolean;
  isHttp?: boolean;
  probe: ProbeResult;
}

export type WebhookFieldValueType = "text_rich" | "text" | "number" | "checkbox" | "date";
export type WebhookPayloadMode = "add_records" | "fields" | "raw_object";

export interface WebhookFieldMapping {
  fieldKey: string;
  label: string;
  sourceKey: string;
  valueType: WebhookFieldValueType | string;
  defaultValue: string;
}

export interface SmartsheetWebhookProfile {
  id: string;
  name: string;
  webhookUrl: string;
  shareUrl: string;
  payloadMode: WebhookPayloadMode | string;
  fields: WebhookFieldMapping[];
  createdAt: string;
}

export interface TencentDocPublishRecord {
  id: string;
  kind: "mcp_doc" | "mcp_tool" | "smartsheet_webhook" | string;
  title: string;
  sourceLabel: string;
  docUrl: string;
  fileId: string;
  status: "success" | "failed" | string;
  message: string;
  createdAt: string;
}

export interface TencentDocsConfig {
  mcpUrl: string;
  mcpToken: string;
  defaultParentId: string;
  preferredDocTool: string;
  docTitleArg: string;
  docContentArg: string;
  docParentArg: string;
  requestTimeoutSecs: number;
  webhooks: SmartsheetWebhookProfile[];
  history: TencentDocPublishRecord[];
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  serverName: string;
  sessionId?: string | null;
  tools: McpToolInfo[];
  message: string;
}

export interface McpToolCallResult {
  record: TencentDocPublishRecord;
  rawResult: unknown;
}

export interface WebhookPushResult {
  record: TencentDocPublishRecord;
  pushedRows: number;
  rawResponses: unknown[];
}
