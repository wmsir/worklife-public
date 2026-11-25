import { useEffect, useId, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { clearMembersCache, getMembers, type MemberOption } from "../lib/wtx";
import { useAppStore } from "../store/appStore";

interface MemberSelectProps {
  value: string;
  onChange: (val: string) => void;
  onPick?: (member: MemberOption) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MemberSelect({
  value,
  onChange,
  onPick,
  placeholder = "输入姓名或从下拉选择...",
  disabled = false,
  className = "",
}: MemberSelectProps) {
  const listId = useId();
  const user = useAppStore((s) => s.user);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (force = false) => {
    if (!user) return;
    setLoading(true);
    try {
      if (force) clearMembersCache();
      const list = await getMembers(force);
      setMembers(list);
    } catch {
      // Non-blocking: user can still type manually
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(user)]);

  const handleInputChange = (nextVal: string) => {
    onChange(nextVal);
    if (!onPick) return;
    const trimmed = nextVal.trim();
    if (!trimmed) return;
    // Match either "Name (ERP)" format or exact name/ERP
    const parenMatch = trimmed.match(/^(.+?)\s*[（(]([^()（）]+)[)）]$/);
    if (parenMatch) {
      const mName = parenMatch[1].trim();
      const mErp = parenMatch[2].trim();
      const found = members.find((m) => m.erp === mErp || m.name === mName);
      if (found) {
        onChange(found.name);
        onPick(found);
        return;
      }
    }
    const exact = members.find((m) => m.name === trimmed || m.erp === trimmed);
    if (exact) {
      onPick(exact);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="relative min-w-0 flex-1">
        <Users className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          list={listId}
          value={value}
          disabled={disabled}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pr-3 pl-8 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <datalist id={listId}>
          {members.map((m) => (
            <option
              key={m.erp || m.name}
              value={m.erp ? `${m.name} (${m.erp})` : m.name}
            >
              {m.positionName ? `${m.name} · ${m.positionName}` : m.name}
            </option>
          ))}
        </datalist>
      </div>
      {user && (
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || disabled}
          title="刷新空间成员列表"
          className="shrink-0 rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50 hover:text-blue-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}
