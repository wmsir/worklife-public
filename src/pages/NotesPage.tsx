import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Edit2,
  Eye,
  FileText,
  FileUp,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { confirmDialog } from "../components/ConfirmDialog";
import { TencentDocPushModal } from "../components/TencentDocPushModal";
import { formatIsoTimeZh } from "../lib/date";
import type { NoteArea, NoteItem, NoteKind } from "../lib/types";
import { useAppStore } from "../store/appStore";

const NOTE_COLORS = [
  { hex: "#ffffff", label: "纯白" },
  { hex: "#eff6ff", label: "浅蓝" },
  { hex: "#ecfdf5", label: "薄荷" },
  { hex: "#fefce8", label: "暖黄" },
  { hex: "#fdf2f8", label: "樱粉" },
  { hex: "#f5f3ff", label: "淡紫" },
];

const LANGUAGES = ["text", "markdown", "sql", "git", "shell", "json", "java", "ts"];

interface NoteModalProps {
  open: boolean;
  initial: NoteItem | null;
  defaultKind?: NoteKind;
  onClose: () => void;
  onSave: (note: Partial<NoteItem> & { title: string; content: string }) => Promise<void>;
}

function NoteModal({ open, initial, defaultKind = "note", onClose, onSave }: NoteModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<NoteKind>(defaultKind);
  const [area, setArea] = useState<NoteArea>("work");
  const [language, setLanguage] = useState("text");
  const [color, setColor] = useState("#ffffff");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [pinned, setPinned] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(false);
    setTagInput("");
    if (initial) {
      setTitle(initial.title);
      setContent(initial.content);
      setKind(initial.kind);
      setArea(initial.area);
      setLanguage(initial.language || "text");
      setColor(initial.color || "#ffffff");
      setTags(initial.tags || []);
      setPinned(Boolean(initial.pinned));
    } else {
      setTitle("");
      setContent("");
      setKind(defaultKind);
      setArea("work");
      setLanguage(defaultKind === "snippet" ? "sql" : "markdown");
      setColor(defaultKind === "snippet" ? "#eff6ff" : "#ffffff");
      setTags([]);
      setPinned(false);
    }
  }, [open, initial, defaultKind]);

  if (!open) return null;

  const addTag = () => {
    const clean = tagInput.trim().replace(/^#/, "");
    if (!clean) return;
    if (!tags.includes(clean)) setTags((p) => [...p, clean]);
    setTagInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) {
      toast.error("请输入标题或正文内容");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || "",
        title: title.trim() || content.trim().split("\n")[0].slice(0, 30),
        content,
        kind,
        area,
        language,
        color,
        tags,
        pinned,
        copyCount: initial?.copyCount || 0,
        createdAt: initial?.createdAt || "",
      });
      onClose();
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? "编辑便签 / 片段" : kind === "snippet" ? "新建常用片段" : "新建随手便签"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block font-medium text-gray-700">标题 *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：生产库排查慢 SQL / 常用测试账号 / 外出清单"
                autoFocus
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">归属领域</label>
              <select
                value={area}
                onChange={(e) => setArea(e.target.value as NoteArea)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="work">工作区</option>
                <option value="life">生活区</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setKind("note")}
                  className={`rounded-md px-2.5 py-1 ${
                    kind === "note" ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
                  }`}
                >
                  随手便签
                </button>
                <button
                  type="button"
                  onClick={() => setKind("snippet")}
                  className={`rounded-md px-2.5 py-1 ${
                    kind === "snippet" ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
                  }`}
                >
                  代码/常用片段
                </button>
              </div>

              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>

              <label className="flex cursor-pointer items-center gap-1.5 text-gray-700">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="rounded border-gray-300 text-amber-500"
                />
                <span>置顶卡片</span>
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(c.hex)}
                  className={`h-5 w-5 rounded-full border ${
                    color === c.hex ? "scale-110 border-gray-900" : "border-gray-300"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-medium text-gray-700">内容（支持一键复制 / Markdown）</label>
              {kind === "note" && (
                <button
                  type="button"
                  onClick={() => setPreview((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
                >
                  <Eye className="h-3 w-3" />
                  <span>{preview ? "返回编辑" : "Markdown 预览"}</span>
                </button>
              )}
            </div>
            {preview ? (
              <div className="min-h-48 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 [&_li]:my-0.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || "*（空白）*"}
                </ReactMarkdown>
              </div>
            ) : (
              <textarea
                rows={9}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="输入命令、SQL 模板、接口报文、测试账号、会议要点或灵感备忘..."
                className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-xs leading-relaxed text-gray-900 focus:border-blue-500 focus:outline-none ${
                  kind === "snippet" ? "font-mono" : ""
                }`}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-gray-600">标签:</span>
            {tags.map((tg) => (
              <span
                key={tg}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
              >
                #{tg}
                <button
                  type="button"
                  onClick={() => setTags((p) => p.filter((x) => x !== tg))}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="+ 添加标签回车"
              className="w-28 rounded border border-gray-200 px-2 py-0.5 text-[11px] focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NotesPage() {
  const { notes, upsertNote, deleteNote, incrementNoteCopy } = useAppStore(
    useShallow((s) => ({
      notes: s.notes,
      upsertNote: s.upsertNote,
      deleteNote: s.deleteNote,
      incrementNoteCopy: s.incrementNoteCopy,
    })),
  );
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<"all" | NoteArea>("all");
  const [kindFilter, setKindFilter] = useState<"all" | NoteKind>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultKind, setModalDefaultKind] = useState<NoteKind>("note");
  const [editing, setEditing] = useState<NoteItem | null>(null);
  const [pushTargetNote, setPushTargetNote] = useState<NoteItem | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) {
      for (const tg of n.tags) s.add(tg);
    }
    return Array.from(s).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (areaFilter !== "all" && n.area !== areaFilter) return false;
      if (kindFilter !== "all" && n.kind !== kindFilter) return false;
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [notes, areaFilter, kindFilter, tagFilter, search]);

  const handleCopy = async (item: NoteItem) => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500);
      await incrementNoteCopy(item.id).catch(() => {});
      toast.success(`已复制「${item.title}」`);
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-amber-500" />
            <h1 className="text-lg font-semibold text-gray-900">便签与常用片段库</h1>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {notes.length} 条
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            工作 SQL / Git 命令 / 测试环境账号 / 常用文本话术与生活备忘清单，随时 Ctrl+K 搜索并一键复制。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalDefaultKind("snippet");
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>新建片段</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalDefaultKind("note");
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建便签</span>
          </button>
        </div>
      </div>

      {/* 检索与筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-xs">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="全文检索标题、命令、内容或标签..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pr-3 pl-8 text-xs focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(
            [
              ["all", "全部领域"],
              ["work", "工作"],
              ["life", "生活"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setAreaFilter(v)}
              className={`rounded-md px-2.5 py-1 ${
                areaFilter === v ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(
            [
              ["all", "全部类型"],
              ["note", "随手便签"],
              ["snippet", "代码片段"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setKindFilter(v)}
              className={`rounded-md px-2.5 py-1 ${
                kindFilter === v ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {allTags.map((tg) => (
              <button
                key={tg}
                type="button"
                onClick={() => setTagFilter((p) => (p === tg ? "" : tg))}
                className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                  tagFilter === tg
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                #{tg}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 卡片网格 */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-14 text-center text-xs text-gray-400">
          暂无匹配的便签或代码片段
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-gray-200 p-4 shadow-2xs transition hover:border-blue-300"
              style={{ backgroundColor: item.color || "#ffffff" }}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.kind === "snippet" ? (
                        <Code2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                      )}
                      <h3 className="truncate text-sm font-semibold text-gray-900">
                        {item.title}
                      </h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium ${
                          item.area === "work"
                            ? "bg-blue-100/80 text-blue-700"
                            : "bg-emerald-100/80 text-emerald-700"
                        }`}
                      >
                        {item.area === "work" ? "工作" : "生活"}
                      </span>
                      <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-gray-600 ring-1 ring-gray-200">
                        {item.language || "text"}
                      </span>
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-white/70 px-1.5 py-0.5 text-gray-600 ring-1 ring-gray-200"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      upsertNote({ ...item, pinned: !item.pinned }).catch((e) =>
                        toast.error(String(e)),
                      )
                    }
                    title={item.pinned ? "取消置顶" : "置顶"}
                    className={`rounded-lg p-1 ${
                      item.pinned
                        ? "bg-amber-100 text-amber-600"
                        : "text-gray-400 hover:bg-black/5 hover:text-gray-700"
                    }`}
                  >
                    {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <pre
                  className={`mt-3 max-h-40 overflow-y-auto rounded-lg border border-black/5 bg-white/80 p-2.5 text-xs leading-relaxed whitespace-pre-wrap text-gray-800 ${
                    item.kind === "snippet" ? "font-mono" : "font-sans"
                  }`}
                >
                  {item.content}
                </pre>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2.5 text-[11px] text-slate-500">
                <span className="lw-nums" title={item.updatedAt}>
                  复制 {item.copyCount} 次 · {formatIsoTimeZh(item.updatedAt)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(item)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-blue-700 ring-1 ring-gray-200 hover:bg-blue-50"
                  >
                    {copiedId === item.id ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{copiedId === item.id ? "已复制" : "一键复制"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPushTargetNote(item)}
                    className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                    title="生成腾讯在线文档"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(item);
                      setModalOpen(true);
                    }}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-black/5 hover:text-gray-800"
                    title="编辑"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${item.title}`}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `确定删除「${item.title}」吗？`,
                        description: "删除后便签/代码片段内容将无法恢复。",
                        confirmText: "确认删除",
                        tone: "danger",
                      });
                      if (!ok) return;
                      try {
                        await deleteNote(item.id);
                        toast.success("已删除");
                      } catch (e) {
                        toast.error(String(e));
                      }
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <NoteModal
        open={modalOpen}
        initial={editing}
        defaultKind={modalDefaultKind}
        onClose={() => setModalOpen(false)}
        onSave={async (n) => {
          await upsertNote(n);
          toast.success(n.id ? "便签已更新" : "已保存新便签");
        }}
      />

      <TencentDocPushModal
        open={Boolean(pushTargetNote)}
        onClose={() => setPushTargetNote(null)}
        initialTitle={pushTargetNote?.title || ""}
        initialMarkdown={
          pushTargetNote
            ? pushTargetNote.kind === "snippet"
              ? `\`\`\`${pushTargetNote.language || ""}\n${pushTargetNote.content}\n\`\`\``
              : pushTargetNote.content
            : ""
        }
        sourceLabel="便签与代码片段"
      />
    </div>
  );
}
