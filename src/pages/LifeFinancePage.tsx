import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  Plus,
  Repeat,
  Search,
  Settings2,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { confirmDialog } from "../components/ConfirmDialog";
import { DateBadge } from "../components/DateBadge";
import { DatePicker, MonthPicker } from "../components/DatePicker";
import { api } from "../lib/api";
import { formatMonthZh, todayYmd } from "../lib/date";
import type { FinanceTransaction, RecurringBill, TransactionKind } from "../lib/types";
import { useAppStore } from "../store/appStore";

const EXPENSE_CATEGORIES = [
  "餐饮",
  "交通",
  "购物",
  "居住",
  "医疗",
  "娱乐",
  "学习",
  "订阅",
  "人情",
  "其他",
];
const INCOME_CATEGORIES = ["工资", "奖金", "报销", "理财", "副业", "其他"];
const ACCOUNTS = ["微信", "支付宝", "银行卡", "信用卡", "现金"];

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

interface BillModalProps {
  open: boolean;
  initial: RecurringBill | null;
  onClose: () => void;
  onSave: (bill: Partial<RecurringBill> & { name: string; amount: number; dueDay: number }) => Promise<void>;
}

function RecurringBillModal({ open, initial, onClose, onSave }: BillModalProps) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("居住");
  const [dueDay, setDueDay] = useState(1);
  const [account, setAccount] = useState("银行卡");
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setAmount(String(initial.amount));
      setCategory(initial.category);
      setDueDay(initial.dueDay);
      setAccount(initial.account);
      setNote(initial.note);
      setActive(initial.active);
    } else {
      setName("");
      setAmount("");
      setCategory("居住");
      setDueDay(1);
      setAccount("银行卡");
      setNote("");
      setActive(true);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (!name.trim() || !numAmt || numAmt <= 0) {
      toast.error("请输入有效的账单名称和正数金额");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || "",
        name: name.trim(),
        amount: numAmt,
        category,
        dueDay: Math.min(31, Math.max(1, Number(dueDay) || 1)),
        account,
        note: note.trim(),
        active,
        lastRecordedMonth: initial?.lastRecordedMonth ?? null,
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
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? "编辑固定周期账单" : "添加固定周期账单 / 订阅"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-gray-700">名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：房租 / 宽带费 / 阿里云会员 / 话费"
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-gray-700">金额 (元) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">每月账单日 (1-31)</label>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-gray-700">分类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">账户</label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
              >
                {ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-gray-700">备注</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选说明"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-gray-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <span>启用此周期账单（计入每月固定支出总额）</span>
          </label>

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

interface TxEditModalProps {
  tx: FinanceTransaction | null;
  onClose: () => void;
  onSave: (tx: Partial<FinanceTransaction> & { date: string; amount: number }) => Promise<void>;
}

function TxEditModal({ tx, onClose, onSave }: TxEditModalProps) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("餐饮");
  const [account, setAccount] = useState("微信");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tx) return;
    setKind(tx.kind);
    setAmount(String(tx.amount));
    setDate(tx.date);
    setCategory(tx.category);
    setAccount(tx.account);
    setNote(tx.note);
  }, [tx]);

  if (!tx) return null;

  const cats = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!num || num <= 0 || !date) {
      toast.error("请输入有效的金额与日期");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: tx.id,
        kind,
        amount: num,
        date,
        category,
        account,
        note: note.trim(),
        createdAt: tx.createdAt,
      });
      onClose();
    } catch (err) {
      toast.error(`修改失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">编辑记账明细</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-gray-700">收支类型</label>
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as TransactionKind;
                  setKind(k);
                  setCategory(k === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">金额 (元)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block font-medium text-slate-700">日期</label>
              <DatePicker value={date} onChange={setDate} size="sm" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">分类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs"
              >
                {cats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">账户</label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs"
              >
                {ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-gray-700">备注</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
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
              {saving ? "保存中..." : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LifeFinancePage() {
  const {
    finance,
    setMonthlyBudget,
    upsertTransaction,
    deleteTransaction,
    upsertRecurringBill,
    deleteRecurringBill,
    recordRecurringBillForMonth,
  } = useAppStore(
    useShallow((s) => ({
      finance: s.finance,
      setMonthlyBudget: s.setMonthlyBudget,
      upsertTransaction: s.upsertTransaction,
      deleteTransaction: s.deleteTransaction,
      upsertRecurringBill: s.upsertRecurringBill,
      deleteRecurringBill: s.deleteRecurringBill,
      recordRecurringBillForMonth: s.recordRecurringBillForMonth,
    })),
  );

  const today = todayYmd();
  const currentYm = today.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentYm);

  // Quick add form state
  const [quickKind, setQuickKind] = useState<TransactionKind>("expense");
  const [quickAmount, setQuickAmount] = useState("");
  const [quickCategory, setQuickCategory] = useState("餐饮");
  const [quickAccount, setQuickAccount] = useState("微信");
  const [quickDate, setQuickDate] = useState(today);
  const [quickNote, setQuickNote] = useState("");
  const [addingTx, setAddingTx] = useState(false);

  // Filters for transaction list
  const [txKindFilter, setTxKindFilter] = useState<"all" | TransactionKind>("all");
  const [txCatFilter, setTxCatFilter] = useState("");
  const [txSearch, setTxSearch] = useState("");

  // Modals
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState("5000");

  useEffect(() => {
    if (selectedMonth === currentYm) setQuickDate(today);
    else setQuickDate(`${selectedMonth}-01`);
  }, [selectedMonth, currentYm, today]);

  const data = finance ?? {
    monthlyBudget: 5000,
    transactions: [],
    recurringBills: [],
  };

  const monthTxs = useMemo(
    () => data.transactions.filter((tx) => tx.date.startsWith(selectedMonth)),
    [data.transactions, selectedMonth],
  );

  const monthExpense = useMemo(
    () =>
      monthTxs
        .filter((t) => t.kind === "expense")
        .reduce((acc, t) => acc + t.amount, 0),
    [monthTxs],
  );

  const monthIncome = useMemo(
    () =>
      monthTxs
        .filter((t) => t.kind === "income")
        .reduce((acc, t) => acc + t.amount, 0),
    [monthTxs],
  );

  const balance = monthIncome - monthExpense;
  const budgetPct =
    data.monthlyBudget > 0
      ? Math.round((monthExpense / data.monthlyBudget) * 100)
      : 0;

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of monthTxs) {
      if (t.kind !== "expense") continue;
      map[t.category] = (map[t.category] || 0) + t.amount;
    }
    return Object.entries(map)
      .map(([category, amount]) => ({
        category,
        amount: Math.round(amount * 100) / 100,
        pct: monthExpense > 0 ? Math.round((amount / monthExpense) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthTxs, monthExpense]);

  const dailySeries = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const maxDay = new Date(y, m, 0).getDate();
    const map: Record<string, number> = {};
    for (const t of monthTxs) {
      if (t.kind !== "expense") continue;
      const dayNum = t.date.slice(8, 10);
      map[dayNum] = (map[dayNum] || 0) + t.amount;
    }
    const rows: Array<{ day: string; amount: number }> = [];
    for (let d = 1; d <= maxDay; d += 1) {
      const k = String(d).padStart(2, "0");
      rows.push({ day: `${d}`, amount: Math.round((map[k] || 0) * 100) / 100 });
    }
    return rows;
  }, [monthTxs, selectedMonth]);

  const filteredMonthTxs = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return monthTxs.filter((t) => {
      if (txKindFilter !== "all" && t.kind !== txKindFilter) return false;
      if (txCatFilter && t.category !== txCatFilter) return false;
      if (!q) return true;
      return (
        t.category.toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q) ||
        t.account.toLowerCase().includes(q)
      );
    });
  }, [monthTxs, txKindFilter, txCatFilter, txSearch]);

  const activeBillsTotal = useMemo(
    () =>
      data.recurringBills
        .filter((b) => b.active)
        .reduce((acc, b) => acc + b.amount, 0),
    [data.recurringBills],
  );

  const handleQuickAddTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(quickAmount);
    if (!num || num <= 0) {
      toast.error("请输入大于 0 的金额");
      return;
    }
    setAddingTx(true);
    try {
      await upsertTransaction({
        date: quickDate || today,
        kind: quickKind,
        amount: num,
        category: quickCategory,
        account: quickAccount,
        note: quickNote.trim(),
      });
      setQuickAmount("");
      setQuickNote("");
      toast.success(
        `已记入${quickKind === "income" ? "收入" : "支出"} ¥${num.toFixed(2)}`,
      );
    } catch (err) {
      toast.error(`记账失败: ${err}`);
    } finally {
      setAddingTx(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvPath = await api.exportFinanceCsv(selectedMonth);
      const dir = csvPath.replace(/[\\/][^\\/]+$/, "");
      toast.success(`已导出 CSV 至: ${csvPath}`, {
        action: {
          label: "打开目录",
          onClick: () => {
            void api.openLocalPath(dir).catch(() => {});
          },
        },
      });
    } catch (err) {
      toast.error(`导出失败: ${err}`);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(budgetInput);
    if (Number.isNaN(val) || val < 0) {
      toast.error("请输入合法的预算金额");
      return;
    }
    try {
      await setMonthlyBudget(val);
      setBudgetEditing(false);
      toast.success(`月度预算已更新为 ¥${val.toFixed(0)}`);
    } catch (err) {
      toast.error(`保存预算失败: ${err}`);
    }
  };

  const currentCats = quickKind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="space-y-5">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" />
            <h1 className="text-lg font-semibold text-gray-900">个人轻记账与月度预算</h1>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/90 p-0.5">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setSelectedMonth((m) => shiftYm(m, -1))}
              className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <MonthPicker
              value={selectedMonth}
              onChange={(ym) => ym && setSelectedMonth(ym)}
              size="sm"
              className="min-w-[116px]"
            />
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setSelectedMonth((m) => shiftYm(m, 1))}
              className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {selectedMonth !== currentYm && (
            <button
              type="button"
              onClick={() => setSelectedMonth(currentYm)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              回本月
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {budgetEditing ? (
            <form onSubmit={handleSaveBudget} className="flex items-center gap-1.5 text-xs">
              <input
                type="number"
                min={0}
                step="100"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                autoFocus
                className="w-28 rounded-lg border border-blue-400 px-2.5 py-1.5 text-xs focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setBudgetEditing(false)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600"
              >
                取消
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setBudgetInput(String(data.monthlyBudget));
                setBudgetEditing(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Settings2 className="h-3.5 w-3.5 text-blue-600" />
              <span>设置月预算 (¥{data.monthlyBudget.toFixed(0)})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>导出本月 CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingBill(null);
              setBillModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加固定账单</span>
          </button>
        </div>
      </div>

      {/* 4 KPI 卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lw-card p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{formatMonthZh(selectedMonth)} 支出</span>
            <ArrowUpCircle className="h-4 w-4 text-rose-500" aria-hidden="true" />
          </div>
          <div className="lw-nums mt-2 text-2xl font-bold text-slate-900">
            ¥{monthExpense.toFixed(2)}
          </div>
          <div className="lw-nums mt-1 text-[11px] text-slate-400">
            共 {monthTxs.filter((t) => t.kind === "expense").length} 笔消费记录
          </div>
        </div>

        <div className="lw-card p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{formatMonthZh(selectedMonth)} 收入</span>
            <ArrowDownCircle className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="lw-nums mt-2 text-2xl font-bold text-emerald-700">
            ¥{monthIncome.toFixed(2)}
          </div>
          <div className="lw-nums mt-1 text-[11px] text-slate-400">
            共 {monthTxs.filter((t) => t.kind === "income").length} 笔入账记录
          </div>
        </div>

        <div className="lw-card p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>本月净结余</span>
            <Wallet className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <div
            className={`lw-nums mt-2 text-2xl font-bold ${
              balance >= 0 ? "text-slate-900" : "text-rose-600"
            }`}
          >
            {balance >= 0 ? "+" : "-"}¥{Math.abs(balance).toFixed(2)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">收入 - 支出</div>
        </div>

        <div className="lw-card p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>月度预算消耗</span>
            <span
              className={`lw-nums font-semibold ${
                budgetPct > 100
                  ? "text-rose-600"
                  : budgetPct >= 80
                    ? "text-amber-600"
                    : "text-emerald-600"
              }`}
            >
              {budgetPct}%
            </span>
          </div>
          <div className="lw-nums mt-2 text-lg font-bold text-slate-900">
            {data.monthlyBudget > 0
              ? `余 ¥${(data.monthlyBudget - monthExpense).toFixed(0)}`
              : "未设预算"}
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                budgetPct > 100
                  ? "bg-rose-500"
                  : budgetPct >= 80
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 极速一行记账条 */}
      <form
        onSubmit={handleQuickAddTx}
        className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => {
                setQuickKind("expense");
                setQuickCategory(EXPENSE_CATEGORIES[0]);
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${
                quickKind === "expense"
                  ? "bg-rose-600 text-white"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              支出
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickKind("income");
                setQuickCategory(INCOME_CATEGORIES[0]);
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${
                quickKind === "income"
                  ? "bg-emerald-600 text-white"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              收入
            </button>
          </div>

          <input
            type="number"
            step="0.01"
            min="0.01"
            value={quickAmount}
            onChange={(e) => setQuickAmount(e.target.value)}
            placeholder="金额 (¥)"
            className="w-32 rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm font-semibold text-gray-900 focus:border-blue-500 focus:outline-none"
          />

          <select
            value={quickAccount}
            onChange={(e) => setQuickAccount(e.target.value)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-700"
          >
            {ACCOUNTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <DatePicker
            value={quickDate}
            onChange={setQuickDate}
            size="sm"
            className="w-36"
          />

          <input
            type="text"
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            placeholder="备注说明（如：午饭套餐 / 地铁通勤 / 房租）"
            className="min-w-44 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={addingTx}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>记一笔</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-400">快捷分类:</span>
          {currentCats.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setQuickCategory(cat)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                quickCategory === cat
                  ? "bg-blue-600 font-medium text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </form>

      {/* 双栏图表分析 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="lw-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {formatMonthZh(selectedMonth)} 分类支出构成
          </h2>
          {categoryBreakdown.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              本月暂无支出明细，上方记一笔即刻生成占比分布
            </div>
          ) : (
            <div className="space-y-2.5 text-xs">
              {categoryBreakdown.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-gray-800">{c.category}</span>
                    <span className="font-mono text-gray-600">
                      ¥{c.amount.toFixed(2)}{" "}
                      <span className="text-gray-400">({c.pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lw-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {formatMonthZh(selectedMonth)} 每日消费趋势 (元)
          </h2>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={40} />
                <Tooltip
                  formatter={(v) => [`¥${Number(v).toFixed(2)}`, "当日支出"]}
                  labelFormatter={(l) => `${selectedMonth}-${String(l).padStart(2, "0")}`}
                />
                <Bar dataKey="amount" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 下半区：流水明细 + 固定周期账单 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="lw-card lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 className="lw-nums text-sm font-semibold text-slate-900">
              {formatMonthZh(selectedMonth)} 收支明细 ({filteredMonthTxs.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  placeholder="搜备注/分类..."
                  className="w-36 rounded-lg border border-gray-200 bg-gray-50 py-1 pr-2 pl-7 text-xs focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>
              <select
                value={txKindFilter}
                onChange={(e) => setTxKindFilter(e.target.value as "all" | TransactionKind)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <option value="all">全部收支</option>
                <option value="expense">仅支出</option>
                <option value="income">仅收入</option>
              </select>
              <select
                value={txCatFilter}
                onChange={(e) => setTxCatFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">全部分类</option>
                {Array.from(new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredMonthTxs.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">暂无收支明细</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 text-[11px] text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">日期</th>
                    <th className="px-4 py-2.5 font-medium">分类</th>
                    <th className="px-4 py-2.5 font-medium">备注 / 账户</th>
                    <th className="px-4 py-2.5 text-right font-medium">金额</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredMonthTxs.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <DateBadge
                          date={tx.date}
                          variant="inline"
                          showIcon={false}
                          showWeekday
                          showRelative={false}
                        />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            tx.kind === "income"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {tx.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">
                        <div>{tx.note || "-"}</div>
                        <div className="text-[10px] text-gray-400">{tx.account}</div>
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${
                          tx.kind === "income" ? "text-emerald-700" : "text-gray-900"
                        }`}
                      >
                        {tx.kind === "income" ? "+" : "-"}¥{tx.amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditingTx(tx)}
                          className="mr-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          title="编辑"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            deleteTransaction(tx.id)
                              .then(() => toast.success("已删除明细"))
                              .catch((e) => toast.error(String(e)))
                          }
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 右栏：固定周期账单与订阅 */}
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Repeat className="h-4 w-4 text-indigo-600" />
                <span>固定周期账单 / 订阅</span>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                每月固定合计：¥{activeBillsTotal.toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingBill(null);
                setBillModalOpen(true);
              }}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              + 添加
            </button>
          </div>

          {data.recurringBills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-3 py-10 text-center text-xs text-gray-400">
              可登记房租、宽带、话费、会员订阅等每月固定支出，支持一键入账本月
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.recurringBills.map((bill) => {
                const recorded = bill.lastRecordedMonth === selectedMonth;
                return (
                  <div
                    key={bill.id}
                    className={`rounded-xl border p-3 text-xs ${
                      bill.active ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-gray-900">
                            {bill.name}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                            {bill.category}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                          <span className="inline-flex items-center gap-0.5">
                            <CalendarClock className="h-3 w-3" />
                            每月 {bill.dueDay} 号
                          </span>
                          <span>· {bill.account}</span>
                        </div>
                      </div>
                      <span className="font-mono text-sm font-bold text-gray-900">
                        ¥{bill.amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                      {recorded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <Check className="h-3 w-3" />
                          {selectedMonth} 已入账
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            recordRecurringBillForMonth(bill.id, selectedMonth)
                              .then(() =>
                                toast.success(
                                  `已将「${bill.name}」¥${bill.amount} 记入 ${selectedMonth}`,
                                ),
                              )
                              .catch((e) => toast.error(String(e)))
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          <Plus className="h-3 w-3" />
                          <span>一键记入 {selectedMonth}</span>
                        </button>
                      )}

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBill(bill);
                            setBillModalOpen(true);
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: `确定删除固定账单「${bill.name}」吗？`,
                              description: "已记入本月的历史流水不会被删除。",
                              confirmText: "确认删除",
                              tone: "danger",
                            });
                            if (!ok) return;
                            try {
                              await deleteRecurringBill(bill.id);
                              toast.success("已删除固定账单");
                            } catch (e) {
                              toast.error(String(e));
                            }
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`删除固定账单 ${bill.name}`}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <RecurringBillModal
        open={billModalOpen}
        initial={editingBill}
        onClose={() => setBillModalOpen(false)}
        onSave={async (b) => {
          await upsertRecurringBill(b);
          toast.success(b.id ? "固定账单已更新" : "固定账单已添加");
        }}
      />

      <TxEditModal
        tx={editingTx}
        onClose={() => setEditingTx(null)}
        onSave={async (tx) => {
          await upsertTransaction(tx);
          toast.success("记账明细已更新");
        }}
      />
    </div>
  );
}
