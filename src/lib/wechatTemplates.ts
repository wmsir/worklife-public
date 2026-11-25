import type { WechatConfig } from "./types";

export type WechatTemplateKey =
  | "template_report"
  | "template_mr"
  | "template_test"
  | "template_miss";

export interface WechatTemplatePreset {
  id: "business" | "minimal" | "vivid";
  name: string;
  badge: string;
  desc: string;
  templates: Record<WechatTemplateKey, string>;
}

export interface WechatTemplateFieldMeta {
  key: WechatTemplateKey;
  title: string;
  vars: Array<{ token: string; desc: string }>;
  sampleVars: Record<string, string>;
}

export const WECHAT_TEMPLATE_PRESETS: WechatTemplatePreset[] = [
  {
    id: "business",
    name: "商务卡片风",
    badge: "默认推荐",
    desc: "结构清晰 + 颜色高亮重点数字与状态，阅读体验佳",
    templates: {
      template_report: [
        "### 📊 工时批量提报完成通知",
        '> 状态：<font color="info">{status_desc}</font>',
        "",
        "* **提报人员**：{user_name}",
        '* **提报时间**：<font color="comment">{time}</font>',
        '* **提报条数**：<font color="info">{plan_count} 条</font>',
        "",
        "📋 **成功明细**：",
        "{report_details}",
      ].join("\n"),
      template_mr: [
        "### 🚀 批量提交 MR 完成通知",
        '> 目标环境：<font color="info">{dest_branches}</font>（涉及 **{project_count}** 个仓库）',
        "",
        "* **操作人员**：{user_name}",
        "* **源分支**：`{src_branch}`",
        "* **评审人员**：{reviewers}",
        '* **提交时间**：<font color="comment">{time}</font>',
        "",
        "🔗 **合并审查链接**：",
        "{mr_links}",
      ].join("\n"),
      template_test: [
        "### 🧪 企微推送通道测试",
        '> 状态：<font color="info">连接正常，消息送达测试通过</font>',
        "",
        "* **推送模式**：`{mode}`",
        "* **接收对象**：{target}",
        '* **测试时间**：<font color="comment">{time}</font>',
      ].join("\n"),
      template_miss: [
        "### ⏰ 工时缺报提醒通知",
        '> <font color="warning">存在 {miss_count} 个未达标工作日，请及时补报</font>',
        "",
        "* **提醒对象**：{user_name}",
        "* **统计周期**：{start_date} 至 {end_date}",
        '* **缺报天数**：<font color="warning">{miss_count} 天</font>',
        '* **通知时间**：<font color="comment">{time}</font>',
        "",
        "📋 **缺报/不足明细**：",
        "{miss_details}",
      ].join("\n"),
    },
  },
  {
    id: "minimal",
    name: "极简清爽风",
    badge: "简洁高效",
    desc: "紧凑单行摘要 + 代码块样式，适合高频通知不刷屏",
    templates: {
      template_report: [
        "### ✅ 工时提报完成（{plan_count} 条）",
        '**{user_name}** · <font color="comment">{time}</font> · <font color="info">{status_desc}</font>',
        "",
        "{report_details}",
      ].join("\n"),
      template_mr: [
        "### 🔀 MR 已提交 · {dest_branches}",
        "**操作人**：{user_name} ｜ **源分支**：`{src_branch}`",
        "**仓库数**：{project_count} ｜ **评审**：{reviewers}",
        "",
        "{mr_links}",
      ].join("\n"),
      template_test: [
        "### 🧪 企微通道连接正常",
        "> 模式：`{mode}` · 目标：{target}",
        '> 时间：<font color="comment">{time}</font>',
      ].join("\n"),
      template_miss: [
        "### 📌 工时待补报提醒（{miss_count} 天）",
        "**{user_name}** · 周期 {start_date} ~ {end_date}",
        "",
        "{miss_details}",
      ].join("\n"),
    },
  },
  {
    id: "vivid",
    name: "活力醒目风",
    badge: "强提示",
    desc: "突出关键数值与异常提醒，适合团队群消息通知",
    templates: {
      template_report: [
        "### 🎉 工时提报战报",
        '> 👏 **{user_name}** 已完成 <font color="info">**{plan_count} 条**</font> 工时填报（{status_desc}）',
        "",
        "🕒 **提报时间**：`{time}`",
        "📝 **填报明细**：",
        "{report_details}",
      ].join("\n"),
      template_mr: [
        "### ⚡ 代码合并请求已发起",
        '> 🎯 目标分支：<font color="info">**{dest_branches}**</font>（共 **{project_count}** 个工程）',
        "",
        "👤 **发起人**：{user_name}",
        "🌿 **源分支**：`{src_branch}`",
        "👀 **邀请评审**：{reviewers}",
        "🕒 **时间**：{time}",
        "",
        "🔗 **点击进入审查**：",
        "{mr_links}",
      ].join("\n"),
      template_test: [
        "### 🔔 企微配置验证成功！",
        '> ✅ <font color="info">通道畅通，后续提报与缺报提醒将按当前模板格式推送</font>',
        "",
        "📡 **模式**：`{mode}` ｜ 🎯 **接收方**：{target}",
        "🕒 **测试时间**：`{time}`",
      ].join("\n"),
      template_miss: [
        "### 🚨 工时缺报/不足预警",
        '> ⚠️ 请 <font color="warning">**{user_name}**</font> 留意：统计周期内共有 <font color="warning">**{miss_count} 天**</font> 工时未达标！',
        "",
        "📅 **统计区间**：{start_date} 至 {end_date}",
        "🕒 **提醒时间**：`{time}`",
        "",
        "📋 **待补报日期**：",
        "{miss_details}",
      ].join("\n"),
    },
  },
];

export const DEFAULT_WECHAT_TEMPLATES: Record<WechatTemplateKey, string> =
  WECHAT_TEMPLATE_PRESETS[0].templates;

export const WECHAT_TEMPLATE_FIELDS: WechatTemplateFieldMeta[] = [
  {
    key: "template_report",
    title: "工时提报模板 (template_report)",
    vars: [
      { token: "{user_name}", desc: "姓名" },
      { token: "{time}", desc: "时间" },
      { token: "{plan_count}", desc: "条数" },
      { token: "{status_desc}", desc: "状态" },
      { token: "{report_details}", desc: "明细" },
    ],
    sampleVars: {
      user_name: "开发同学",
      time: "2026-11-25 18:05:12",
      plan_count: "3",
      status_desc: "全部成功 (3/3)",
      report_details:
        "  • TASK-0001 核心服务优化：3.5h\n  • TASK-0002 对账异常处理：3.5h",
    },
  },
  {
    key: "template_mr",
    title: "MR 通知模板 (template_mr)",
    vars: [
      { token: "{user_name}", desc: "操作人" },
      { token: "{src_branch}", desc: "源分支" },
      { token: "{dest_branches}", desc: "目标环境" },
      { token: "{project_count}", desc: "仓库数" },
      { token: "{reviewers}", desc: "评审人" },
      { token: "{time}", desc: "时间" },
      { token: "{mr_links}", desc: "链接列表" },
    ],
    sampleVars: {
      user_name: "开发同学",
      src_branch: "TASK-0001-DEV-SIT",
      dest_branches: "UAT",
      project_count: "2",
      reviewers: "评审同事",
      time: "2026-11-25 17:40:00",
      mr_links:
        "  • [repo-a] https://devops.example.local/merges/128\n  • [repo-b] https://devops.example.local/merges/129",
    },
  },
  {
    key: "template_test",
    title: "测试流转模板 (template_test)",
    vars: [
      { token: "{mode}", desc: "推送模式" },
      { token: "{target}", desc: "接收对象" },
      { token: "{time}", desc: "时间" },
    ],
    sampleVars: {
      mode: "webhook",
      target: "研发群机器人",
      time: "2026-11-25 14:15:00",
    },
  },
  {
    key: "template_miss",
    title: "缺报提醒模板 (template_miss)",
    vars: [
      { token: "{user_name}", desc: "提醒对象" },
      { token: "{start_date}", desc: "开始日期" },
      { token: "{end_date}", desc: "结束日期" },
      { token: "{miss_count}", desc: "缺报天数" },
      { token: "{time}", desc: "通知时间" },
      { token: "{miss_details}", desc: "缺报明细" },
    ],
    sampleVars: {
      user_name: "开发同学",
      start_date: "2026-11-01",
      end_date: "2026-11-25",
      miss_count: "2",
      time: "2026-11-25 09:30:00",
      miss_details:
        "  • 2026-11-21 (周六 调休): 缺报 (已填 0.0h, 缺 7.0h)\n  • 2026-11-24 (周二): 不足 (已填 3.5h, 缺 3.5h)",
    },
  },
];

export function fillMissingWechatTemplates(wx: WechatConfig): {
  next: WechatConfig;
  filledAny: boolean;
} {
  let filledAny = false;
  const next = { ...wx };
  const keys: WechatTemplateKey[] = [
    "template_report",
    "template_mr",
    "template_test",
    "template_miss",
  ];
  for (const k of keys) {
    if (!next[k] || !next[k].trim()) {
      next[k] = DEFAULT_WECHAT_TEMPLATES[k];
      filledAny = true;
    }
  }
  return { next, filledAny };
}

export function formatWechatSampleText(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}
