import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FileUp, FolderSearch, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { wtCall } from "../lib/api";
import { useAppStore } from "../store/appStore";

export type AttachmentType = "dev" | "design" | "test";

export interface UploadedAttachInfo {
  id: number;
  fileName: string;
  uri?: string;
  boundCardId?: number;
}

interface AttachmentRowState {
  path: string;
  uploading: boolean;
  uploaded?: UploadedAttachInfo;
  error?: string;
}

const ATTACH_META: Array<{
  type: AttachmentType;
  label: string;
  desc: string;
}> = [
  { type: "dev", label: "研发附件 (dev)", desc: "开发自测报告 / 变更说明等" },
  { type: "design", label: "设计附件 (design)", desc: "需求设计说明书 / 方案文档" },
  { type: "test", label: "测试附件 (test)", desc: "功能测试报告 / 测试用例等" },
];

interface AttachmentUploaderProps {
  cardIdOrCode: string | number;
  onDone?: (type: AttachmentType, info: UploadedAttachInfo) => void;
}

export function AttachmentUploader({
  cardIdOrCode,
  onDone,
}: AttachmentUploaderProps) {
  const { user, pushLog } = useAppStore(
    useShallow((s) => ({ user: s.user, pushLog: s.pushLog })),
  );

  const [rows, setRows] = useState<Record<AttachmentType, AttachmentRowState>>({
    dev: { path: "", uploading: false },
    design: { path: "", uploading: false },
    test: { path: "", uploading: false },
  });

  const pickFile = async (attType: AttachmentType) => {
    try {
      const picked = await openDialog({
        multiple: false,
        title: `选择${attType === "dev" ? "研发" : attType === "design" ? "设计" : "测试"}附件`,
      });
      if (typeof picked === "string" && picked.trim()) {
        setRows((prev) => ({
          ...prev,
          [attType]: { ...prev[attType], path: picked.trim(), error: undefined },
        }));
      }
    } catch (e) {
      toast.error(`选择文件失败: ${String(e)}`);
    }
  };

  const uploadAndBind = async (attType: AttachmentType) => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const row = rows[attType];
    if (!row.path.trim()) {
      toast.error("请先选择要上传的文件");
      return;
    }
    const target = String(cardIdOrCode || "").trim();
    if (!target) {
      toast.error("请先查询或输入目标任务/卡片 ID 后再上传绑定");
      return;
    }

    setRows((prev) => ({
      ...prev,
      [attType]: { ...prev[attType], uploading: true, error: undefined },
    }));

    try {
      const uploadRes = await wtCall<{
        id: number;
        fileName?: string;
        uri?: string;
      }>("upload_space_file", { file_path: row.path.trim() });

      const fileId = Number(uploadRes?.id);
      if (!fileId || Number.isNaN(fileId)) {
        throw new Error("文件上传成功但未返回有效 attachmentId");
      }

      const cardId = await wtCall<number>("resolve_card_id", {
        task_or_card_id: target,
      });

      await wtCall("bind_space_card_attachment", {
        card_id: cardId,
        attachment_id: fileId,
        attachment_type: attType,
      });

      const info: UploadedAttachInfo = {
        id: fileId,
        fileName: uploadRes.fileName || row.path.split(/[/\\]/).pop() || "附件",
        uri: uploadRes.uri,
        boundCardId: cardId,
      };

      setRows((prev) => ({
        ...prev,
        [attType]: { ...prev[attType], uploading: false, uploaded: info },
      }));
      toast.success(`已上传并绑定【${info.fileName}】到卡片 [${cardId}]`);
      onDone?.(attType, info);
    } catch (e) {
      const msg = String(e);
      setRows((prev) => ({
        ...prev,
        [attType]: { ...prev[attType], uploading: false, error: msg },
      }));
      pushLog(`❌ 附件上传/绑定失败 (${attType}): ${msg}`);
      toast.error(`上传/绑定失败: ${msg}`);
    }
  };

  return (
    <div className="space-y-2.5">
      {ATTACH_META.map((meta) => {
        const st = rows[meta.type];
        return (
          <div
            key={meta.type}
            className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Paperclip className="h-3.5 w-3.5 text-gray-500" />
                <span className="font-semibold text-gray-800">{meta.label}</span>
                <span className="text-[11px] text-gray-400">{meta.desc}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={st.uploading}
                  onClick={() => pickFile(meta.type)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  <FolderSearch className="h-3 w-3 text-blue-600" />
                  <span>选择文件</span>
                </button>
                <button
                  type="button"
                  disabled={!user || st.uploading || !st.path}
                  onClick={() => uploadAndBind(meta.type)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {st.uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileUp className="h-3 w-3" />
                  )}
                  <span>{st.uploading ? "上传绑定中..." : "上传并绑定"}</span>
                </button>
              </div>
            </div>

            {st.path && (
              <div className="mt-1.5 truncate font-mono text-[11px] text-gray-600">
                已选: {st.path}
              </div>
            )}

            {st.uploaded && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="font-medium">{st.uploaded.fileName}</span>
                <span className="font-mono text-emerald-700">
                  ID:{st.uploaded.id} · 卡片:{st.uploaded.boundCardId}
                </span>
                {st.uploaded.uri && (
                  <span className="truncate font-mono text-[10px] text-emerald-600">
                    {st.uploaded.uri}
                  </span>
                )}
              </div>
            )}

            {st.error && (
              <div className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
                {st.error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
