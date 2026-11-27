import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  KeyRound,
  Loader2,
  Send,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { TencentDocPublishRecord, TencentDocsConfig } from "../lib/types";
import { sendWechat } from "../lib/wtx";

interface Props {
  open: boolean;
  onClose: () => void;
  initialTitle: string;
  initialMarkdown: string;
  sourceLabel?: string;
}

const MCP_AUTH_URL = "https://docs.qq.com/open/auth/mcp.html";

export function TencentDocPushModal({
  open,
  onClose,
  initialTitle,
  initialMarkdown,
  sourceLabel = "Markdown",
}: Props) {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<TencentDocsConfig | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(false);

  const [title, setTitle] = useState(initialTitle);
  const [parentId, setParentId] = useState("");
  const [markdown, setMarkdown] = useState(initialMarkdown);

  const [submitting, setSubmitting] = useState(false);
  const [resultRec, setResultRec] = useState<TencentDocPublishRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendingWechat, setSendingWechat] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setMarkdown(initialMarkdown);
    setResultRec(null);
    setCopied(false);
    setLoadingCfg(true);
    api
      .getTencentDocsConfig()
      .then((c) => {
        setCfg(c);
        setParentId(c.defaultParentId || "");
      })
      .catch((e) => toast.error(`加载腾讯文档配置失败: ${String(e)}`))
      .finally(() => setLoadingCfg(false));
  }, [open, initialTitle, initialMarkdown]);

  if (!open) return null;

  const hasToken = Boolean(cfg?.mcpToken?.trim());

  const handlePublish = async () => {
    if (!title.trim()) {
      toast.error("请输入生成的文档标题");
      return;
    }
    if (!markdown.trim()) {
      toast.error("文档正文不能为空");
      return;
    }
    setSubmitting(true);
    try {
      const rec = await api.publishMarkdownToTencentDoc({
        title: title.trim(),
        markdown,
        parentId: parentId.trim() || null,
        sourceLabel,
      });
      setResultRec(rec);
      toast.success("已成功生成腾讯在线文档");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!resultRec?.docUrl) return;
    try {
      await navigator.clipboard.writeText(resultRec.docUrl);
      setCopied(true);
      toast.success("已复制腾讯文档分享链接");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleSendWechatLink = async () => {
    if (!resultRec?.docUrl) return;
    setSendingWechat(true);
    try {
      const msg = [
        `### 📄 ${resultRec.title}`,
        `* **来源**: ${sourceLabel}`,
        `* **在线链接**: [点击打开腾讯文档](${resultRec.docUrl})`,
        `  ${resultRec.docUrl}`,
      ].join("\n");
      const [ok, ret] = await sendWechat(msg);
      if (ok) {
        toast.success("已推送腾讯文档链接到企业微信");
      } else {
        toast.error(`企微推送未成功: ${ret}`);
      }
    } catch (e) {
      toast.error(`企微推送异常: ${String(e)}`);
    } finally {
      setSendingWechat(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileUp className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              生成腾讯在线文档（官方 MCP）
            </h3>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              {sourceLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {loadingCfg ? (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在检查腾讯文档配置...</span>
            </div>
          ) : (
            <>
              {!hasToken && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <KeyRound className="h-4 w-4 text-amber-700" />
                    <span>尚未配置腾讯文档官方 MCP Token</span>
                  </div>
                  <p className="mt-1 leading-relaxed text-amber-800">
                    个人 QQ / 微信登录后即可免费领取个人 MCP Token。前往腾讯文档设置完成保存后即可一键发布并生成分享链接。
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        api.openExternalUrl(MCP_AUTH_URL).catch((e) => toast.error(String(e)))
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>打开官方 Token 领取页</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate("/tencent-docs");
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span>前往填写 MCP Token</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-2">
                  <span className="font-medium text-gray-700">在线文档标题 *</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入生成到腾讯文档后的标题"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-gray-700">目标目录 ID（可选）</span>
                  <input
                    type="text"
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    placeholder="留空则创建到根目录"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">Markdown 正文内容</span>
                  <span className="text-[11px] text-gray-400">
                    共 {markdown.length} 字 · 工具：{cfg?.preferredDocTool || "create_smartcanvas_by_markdown"}
                  </span>
                </div>
                <textarea
                  rows={10}
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>

              {resultRec && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>已成功发布为腾讯在线智能文档！</span>
                  </div>
                  {resultRec.docUrl ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-blue-700 ring-1 ring-emerald-200">
                        {resultRec.docUrl}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copied ? "已复制" : "复制链接"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          api
                            .openExternalUrl(resultRec.docUrl)
                            .catch((e) => toast.error(String(e)))
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>浏览器打开</span>
                      </button>
                      <button
                        type="button"
                        disabled={sendingWechat}
                        onClick={handleSendWechatLink}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {sendingWechat ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        <span>发企微</span>
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-emerald-800">{resultRec.message}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate("/tencent-docs");
            }}
            className="text-xs font-medium text-gray-500 hover:text-blue-600"
          >
            打开腾讯文档中心 / 高级工具 →
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={submitting || !hasToken}
              onClick={handlePublish}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileUp className="h-3.5 w-3.5" />
              )}
              <span>{submitting ? "生成中..." : "一键生成腾讯文档"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
