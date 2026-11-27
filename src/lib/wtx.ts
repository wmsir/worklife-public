import { useAppStore } from "../store/appStore";
import { api, wtCall } from "./api";
import type { TaskBranchRecord, TaskRecord } from "./types";

const constCache = new Map<string, unknown>();
let membersCache: MemberOption[] | null = null;

export interface RawMember {
  memberName?: string;
  memberErp?: string;
  userName?: string;
  name?: string;
  userErp?: string;
  erp?: string;
  email?: string;
  positionName?: string;
  orgTierCode?: string;
  orgTierName?: string;
  sex?: number;
  isLeader?: boolean;
  type?: number;
  role?: string;
  [k: string]: unknown;
}

export interface MemberOption {
  name: string;
  erp: string;
  email: string;
  positionName: string;
  raw: RawMember;
}

/** Read and cache a constant from worktime backend via `__const`. */
export async function getConst<T = unknown>(name: string): Promise<T> {
  if (constCache.has(name)) {
    return constCache.get(name) as T;
  }
  const val = await wtCall<T>("__const", { name });
  constCache.set(name, val);
  return val;
}

/** Fetch and cache space members from `get_members`. */
export async function getMembers(forceRefresh = false): Promise<MemberOption[]> {
  if (!forceRefresh && membersCache && membersCache.length > 0) {
    return membersCache;
  }
  const rawRes = await wtCall<RawMember[] | { data?: RawMember[] }>("get_members");
  const rawList = Array.isArray(rawRes)
    ? rawRes
    : Array.isArray(rawRes?.data)
      ? rawRes.data
      : [];

  const dedup = new Map<string, MemberOption>();
  for (const m of rawList) {
    if (!m || typeof m !== "object") continue;
    const name = String(m.memberName || m.name || m.userName || "").trim();
    const erp = String(m.memberErp || m.userErp || m.erp || "").trim();
    if (!name) continue;
    const key = erp || name;
    if (!dedup.has(key)) {
      dedup.set(key, {
        name,
        erp,
        email: String(m.email || ""),
        positionName: String(m.positionName || ""),
        raw: m,
      });
    }
  }
  const list = Array.from(dedup.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
  if (list.length > 0) {
    membersCache = list;
  }
  return list;
}

export function clearMembersCache() {
  membersCache = null;
}

export function nowDateTimeStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/** Local midnight timestamp in ms for a `YYYY-MM-DD` date string. */
export function ymdToLocalMs(ymd: string): number | undefined {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return undefined;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
}

export function fmtTpl(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

export function extractTaskCode(input: string): string {
  const m = input.trim().match(/([A-Za-z][A-Za-z0-9_]*-\d+)/);
  return m ? m[1].toUpperCase() : "";
}

export function resolveTaskCode(
  explicitCode: string,
  branchName: string,
  existingTasks: { code: string }[] = [],
): string {
  const cleanExplicit = explicitCode.trim();
  if (cleanExplicit) {
    const exactHit = existingTasks.find(
      (t) => t.code.toLowerCase() === cleanExplicit.toLowerCase(),
    );
    return exactHit ? exactHit.code : cleanExplicit;
  }
  const branch = branchName.trim();
  if (!branch) return "";
  const lowerBranch = branch.toLowerCase();
  const prefixMatch = existingTasks
    .filter((t) => {
      const lc = t.code.trim().toLowerCase();
      if (!lc) return false;
      return (
        lowerBranch === lc ||
        lowerBranch.startsWith(`${lc}-`) ||
        lowerBranch.startsWith(`${lc}_`) ||
        lowerBranch.startsWith(`${lc}/`)
      );
    })
    .sort((a, b) => b.code.length - a.code.length)[0];
  if (prefixMatch) {
    return prefixMatch.code;
  }
  return extractTaskCode(branch);
}

export function shortRepoName(repo: string): string {
  const trimmed = repo.trim();
  return trimmed.split("/").pop() || trimmed;
}

export function getTaskBranches(
  task: TaskRecord | null | undefined,
): TaskBranchRecord[] {
  if (!task) return [];
  if (Array.isArray(task.branches) && task.branches.length > 0) {
    return task.branches.filter((b) => Boolean(b?.branch?.trim()));
  }
  const single = (task.branch || "").trim();
  if (!single) return [];
  return [
    {
      branch: single,
      refBranch: "",
      repos: task.repos ?? [],
      createdAt: task.updatedAt || task.createdAt || "",
      source: "legacy",
    },
  ];
}

/** Send WeChat notice using `send_wechat_notice_ex` and current settings. */
export async function sendWechat(
  content: string,
  erp?: string,
): Promise<[boolean, string]> {
  const { settings, user } = useAppStore.getState();
  const wx = settings?.worktime.wechat_config;
  const fallbackErp =
    wx?.target_erp?.trim() ||
    user?.user.userErp ||
    user?.user.erp ||
    "";
  const targetErp = erp?.trim() || fallbackErp;

  const res = await wtCall<[boolean, string]>("send_wechat_notice_ex", {
    erp: targetErp,
    content,
    custom_cfg: wx,
  });
  return Array.isArray(res) ? [Boolean(res[0]), String(res[1] ?? "")] : [false, String(res)];
}

/** Ensure task folder exists in offline ledger (`<dataRoot>/工作/任务/<code>-<name>`). */
export async function ensureLedgerTask(code: string, name: string): Promise<void> {
  const trimmed = code.trim();
  if (!trimmed) return;
  const store = useAppStore.getState();
  try {
    await store.taskUpdate(trimmed, {});
  } catch {
    try {
      await store.taskCreate(trimmed, name.trim() || trimmed);
    } catch (err) {
      store.pushLog(`⚠️ 创建离线任务目录 [${trimmed}] 失败: ${String(err)}`);
    }
  }
}

/** Append one bullet/log line under `## 自动记录` inside `<task>/需求描述.md`. */
export async function appendTaskMd(code: string, line: string): Promise<void> {
  const trimmed = code.trim();
  if (!trimmed || !line.trim()) return;
  const store = useAppStore.getState();
  try {
    const existing = await api.taskReadMd(trimmed);
    const headingRegex = /^##\s+自动记录\s*$/m;
    const match = headingRegex.exec(existing);
    let nextContent: string;
    if (!match) {
      const base = existing.replace(/\s+$/, "");
      nextContent = `${base}\n\n## 自动记录\n${line}\n`;
    } else {
      const afterHeadingIdx = match.index + match[0].length;
      const rest = existing.slice(afterHeadingIdx);
      const nextH2 = /\r?\n##\s+/.exec(rest);
      if (nextH2) {
        const insertAt = afterHeadingIdx + nextH2.index;
        const prefix = existing.slice(0, insertAt).replace(/\s+$/, "");
        const suffix = existing.slice(insertAt);
        nextContent = `${prefix}\n${line}${suffix}`;
      } else {
        const base = existing.replace(/\s+$/, "");
        nextContent = `${base}\n${line}\n`;
      }
    }
    await api.taskWriteMd(trimmed, nextContent);
  } catch (err) {
    store.pushLog(`⚠️ 写入任务 [${trimmed}] 需求描述记录失败: ${String(err)}`);
  }
}
