export interface WorkloadMemberRow {
  name: string;
  erp: string;
  party: "甲" | "乙" | "";
  ratio: number | null;
  workload: number;
}

export interface WorkloadCategoryRow {
  workType: string;
  typeRatio: number | null;
  typeWorkload: number;
  members: WorkloadMemberRow[];
}

export interface ParsedWorkloadDetail {
  estimatedManMonths: number;
  estimatedDays: number;
  partyADays: number;
  partyBDays: number;
  reqDays: number;
  designDays: number;
  devDays: number;
  testDays: number;
  actualReportDays: number;
  addedCodeLines: number | null;
  deletedCodeLines: number | null;
  unsaved: boolean;
  unsavedMessage: string;
  rows: WorkloadCategoryRow[];
  totalTypeRatio: number | null;
  totalTypeWorkload: number;
  uniqueMemberCount: number;
  totalPersonalRatio: number | null;
  totalPersonalWorkload: number;
}

function asObj(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== "object" || Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

function toFiniteNum(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/,/g, "").replace(/%$/, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return "";
}

function pickNum(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): number | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      if (k in src) {
        const n = toFiniteNum(src[k]);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

function pickBool(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): boolean | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1" || s === "yes") return true;
        if (s === "false" || s === "0" || s === "no") return false;
      }
    }
  }
  return null;
}

function detectParty(m: Record<string, unknown>): "甲" | "乙" | "" {
  const rawFields = [
    m.party,
    m.partyName,
    m.partyType,
    m.companyType,
    m.userType,
    m.staffType,
    m.memberType,
    m.personType,
    m.typeName,
    m.source,
    m.ownFlag,
  ];
  for (const rf of rawFields) {
    const s = toStr(rf).toLowerCase();
    if (!s) continue;
    if (
      s.includes("甲") ||
      s === "a" ||
      s === "partya" ||
      s === "first" ||
      s === "internal" ||
      s.includes("自研") ||
      s.includes("行内")
    ) {
      return "甲";
    }
    if (
      s.includes("乙") ||
      s === "b" ||
      s === "partyb" ||
      s === "second" ||
      s === "external" ||
      s.includes("外包") ||
      s.includes("厂商")
    ) {
      return "乙";
    }
  }
  if (typeof m.isOutsource === "boolean") {
    return m.isOutsource ? "乙" : "甲";
  }
  if (typeof m.isInternal === "boolean") {
    return m.isInternal ? "甲" : "乙";
  }
  const numType = toFiniteNum(m.partyType ?? m.userType ?? m.memberType);
  if (numType === 1) return "甲";
  if (numType === 2) return "乙";
  return "";
}

function normalizePercent(val: number | null, shouldScaleUnit: boolean): number | null {
  if (val === null) return null;
  const pct = shouldScaleUnit ? val * 100 : val;
  return Math.round(pct * 100) / 100;
}

export function formatDays(val: number | null | undefined, digits = 4): string {
  const num = typeof val === "number" && Number.isFinite(val) ? val : 0;
  return num.toFixed(digits);
}

export function formatRatioPct(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "-";
  const rounded = Math.round(val * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatCodeLines(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "-";
  return Math.round(val).toLocaleString("en-US");
}

export function parseWorkloadDetail(input: {
  own: unknown;
  actual: unknown;
  detailRaw?: unknown;
  fallbackDeclaredDays?: number;
  fallbackRequiredDays?: number;
}): ParsedWorkloadDetail {
  const ownObj = asObj(input.own);
  const actualObj = asObj(input.actual);
  const summaryObj = asObj(input.detailRaw);
  const cardDetailRaw = asObj(summaryObj?.detail_raw) ?? summaryObj;

  const sources = [
    ownObj,
    asObj(ownObj?.summary),
    asObj(ownObj?.stat),
    asObj(ownObj?.workloadInfo),
    actualObj,
    cardDetailRaw,
    summaryObj,
  ];

  const rawRowsCandidate =
    ownObj?.rows ??
    ownObj?.workloadRows ??
    ownObj?.list ??
    ownObj?.details ??
    ownObj?.items ??
    [];
  const rawRows = Array.isArray(rawRowsCandidate) ? rawRowsCandidate : [];

  const rawTypeRatios = rawRows
    .map((r) => {
      const ro = asObj(r);
      return ro
        ? pickNum(
            [ro],
            ["workTypeRatio", "typeRatio", "ratio", "rate", "percent", "proportion"],
          )
        : null;
    })
    .filter((n): n is number => n !== null);
  const rawRatioSum = rawTypeRatios.reduce((acc, n) => acc + n, 0);
  const scaleUnitToPct =
    rawTypeRatios.length > 0 && rawRatioSum > 0 && rawRatioSum <= 1.05;

  const rows: WorkloadCategoryRow[] = rawRows
    .map((item) => {
      const ro = asObj(item);
      if (!ro) return null;

      const workType =
        toStr(
          ro.workTypeName ??
            ro.typeName ??
            ro.roleName ??
            ro.stageName ??
            ro.workType ??
            ro.name,
        ) || "-";

      const rawMembers =
        ro.members ?? ro.memberList ?? ro.users ?? ro.persons ?? ro.items ?? [];
      const memberArr = Array.isArray(rawMembers) ? rawMembers : [];

      const members: WorkloadMemberRow[] = memberArr
        .map((m) => {
          const mo = asObj(m);
          if (!mo) return null;
          const name =
            toStr(
              mo.name ?? mo.userName ?? mo.memberName ?? mo.realName ?? mo.erp,
            ) || "-";
          const erp = toStr(mo.erp ?? mo.userErp ?? mo.memberErp);
          const party = detectParty(mo);
          const rawMRatio = pickNum(
            [mo],
            ["personalRatio", "userRatio", "ratio", "rate", "percent", "proportion"],
          );
          const workload =
            pickNum(
              [mo],
              ["workload", "personalWorkload", "workDays", "days", "manDays"],
            ) ?? 0;
          return {
            name,
            erp,
            party,
            ratio: normalizePercent(rawMRatio, scaleUnitToPct && (rawMRatio ?? 0) <= 1),
            workload,
          };
        })
        .filter((x): x is WorkloadMemberRow => x !== null);

      const rawTRatio = pickNum(
        [ro],
        ["workTypeRatio", "typeRatio", "ratio", "rate", "percent", "proportion"],
      );
      const memberWorkloadSum = members.reduce((acc, m) => acc + m.workload, 0);
      const explicitTypeWorkload = pickNum(
        [ro],
        ["workTypeWorkload", "typeWorkload", "workload", "totalWorkload", "days"],
      );

      return {
        workType,
        typeRatio: normalizePercent(rawTRatio, scaleUnitToPct),
        typeWorkload: explicitTypeWorkload ?? memberWorkloadSum,
        members,
      };
    })
    .filter((x): x is WorkloadCategoryRow => x !== null);

  const totalTypeWorkload = rows.reduce((acc, r) => acc + r.typeWorkload, 0);
  const typeRatiosPresent = rows.filter((r) => r.typeRatio !== null);
  const totalTypeRatio =
    typeRatiosPresent.length > 0
      ? Math.round(
          typeRatiosPresent.reduce((acc, r) => acc + (r.typeRatio ?? 0), 0) * 100,
        ) / 100
      : null;

  const allMembers = rows.flatMap((r) => r.members);
  const uniqueMembers = new Set(
    allMembers
      .map((m) => (m.erp || m.name).trim())
      .filter((s) => s && s !== "-"),
  );
  const personalRatiosPresent = allMembers.filter((m) => m.ratio !== null);
  const totalPersonalRatio =
    personalRatiosPresent.length > 0
      ? Math.round(
          personalRatiosPresent.reduce((acc, m) => acc + (m.ratio ?? 0), 0) * 100,
        ) / 100
      : null;
  const totalPersonalWorkload = allMembers.reduce((acc, m) => acc + m.workload, 0);

  const findCategoryDays = (pattern: RegExp) => {
    const matched = rows.filter((r) => pattern.test(r.workType));
    if (matched.length === 0) return null;
    return matched.reduce((acc, r) => acc + r.typeWorkload, 0);
  };

  let estimatedDays =
    pickNum(sources, [
      "estimateWorkload",
      "estimatedWorkload",
      "estimateDays",
      "estimatedDays",
      "evaluateDays",
      "planWorkload",
      "totalWorkload",
    ]) ?? null;

  let estimatedManMonths =
    pickNum(sources, [
      "estimateManMonth",
      "estimatedManMonth",
      "estimateManMonths",
      "estimatedManMonths",
      "evaluateManMonth",
      "manMonth",
      "planManMonth",
    ]) ?? null;

  if (estimatedDays === null) {
    if (estimatedManMonths !== null && estimatedManMonths > 0) {
      estimatedDays = estimatedManMonths * 21.75;
    } else if (totalTypeWorkload > 0) {
      estimatedDays = totalTypeWorkload;
    } else if (
      typeof input.fallbackRequiredDays === "number" &&
      Number.isFinite(input.fallbackRequiredDays)
    ) {
      estimatedDays = input.fallbackRequiredDays;
    } else {
      estimatedDays = 0;
    }
  }

  if (estimatedManMonths === null) {
    estimatedManMonths = estimatedDays > 0 ? estimatedDays / 21.75 : 0;
  }

  const partyAMembersSum = allMembers
    .filter((m) => m.party === "甲")
    .reduce((acc, m) => acc + m.workload, 0);
  const partyBMembersSum = allMembers
    .filter((m) => m.party === "乙")
    .reduce((acc, m) => acc + m.workload, 0);
  const hasAnyPartyMarker = allMembers.some((m) => m.party === "甲" || m.party === "乙");

  const partyADays =
    pickNum(sources, [
      "partyAWorkload",
      "partyADays",
      "firstPartyWorkload",
      "firstPartyDays",
      "internalWorkload",
      "selfWorkload",
    ]) ??
    (hasAnyPartyMarker ? partyAMembersSum : totalPersonalWorkload);

  const partyBDays =
    pickNum(sources, [
      "partyBWorkload",
      "partyBDays",
      "secondPartyWorkload",
      "secondPartyDays",
      "outsourceWorkload",
      "externalWorkload",
    ]) ??
    (hasAnyPartyMarker ? partyBMembersSum : 0);

  const reqDays =
    pickNum(sources, ["reqWorkload", "requireWorkload", "reqDays", "demandWorkload"]) ??
    findCategoryDays(/需求|req|demand/i) ??
    0;

  const designDays =
    pickNum(sources, ["designWorkload", "designDays"]) ??
    findCategoryDays(/设计|design/i) ??
    0;

  const devDays =
    pickNum(sources, ["devWorkload", "developWorkload", "devDays"]) ??
    findCategoryDays(/开发|研发|dev/i) ??
    0;

  const testDays =
    pickNum(sources, ["testWorkload", "qaWorkload", "testDays"]) ??
    findCategoryDays(/测试|qa|test/i) ??
    0;

  let actualReportDays = pickNum(sources, [
    "actualReportDays",
    "actualDays",
    "declareDays",
    "declaredDays",
    "declared_days",
  ]);
  if (actualReportDays === null) {
    const rawHours =
      typeof input.actual === "number"
        ? input.actual
        : pickNum(sources, [
            "actualReportHours",
            "actualHours",
            "totalHours",
            "declareHours",
            "hours",
            "declared_hours",
          ]);
    if (rawHours !== null) {
      actualReportDays = rawHours / 7;
    } else if (
      typeof input.fallbackDeclaredDays === "number" &&
      Number.isFinite(input.fallbackDeclaredDays)
    ) {
      actualReportDays = input.fallbackDeclaredDays;
    } else {
      actualReportDays = 0;
    }
  }

  let addedCodeLines = pickNum(sources, [
    "addLine",
    "addLines",
    "addedLines",
    "addCodeLine",
    "addCodeLines",
    "codeAddLine",
    "codeAddLines",
    "insertions",
    "lineAdd",
    "newLineCount",
  ]);
  let deletedCodeLines = pickNum(sources, [
    "delLine",
    "delLines",
    "deleteLine",
    "deleteLines",
    "deletedLines",
    "delCodeLine",
    "delCodeLines",
    "codeDelLine",
    "codeDelLines",
    "deletions",
    "lineDel",
    "deleteLineCount",
  ]);
  if (addedCodeLines !== null && deletedCodeLines === null) deletedCodeLines = 0;
  if (deletedCodeLines !== null && addedCodeLines === null) addedCodeLines = 0;

  const savedFlag = pickBool(sources, ["saved", "isSaved", "hasSaved"]);
  const unsavedFlag = pickBool(sources, ["unsaved", "unSaved", "needSave"]);
  const saveStatus = pickNum(sources, ["saveStatus"]);
  const unsaved =
    unsavedFlag === true ||
    savedFlag === false ||
    saveStatus === 0 ||
    toStr(ownObj?.statusText).includes("未保存");
  const unsavedMessage =
    toStr(ownObj?.unsavedMessage ?? ownObj?.tip ?? ownObj?.notice) ||
    "工作量明细：未保存，请确认后保存。";

  return {
    estimatedManMonths,
    estimatedDays,
    partyADays,
    partyBDays,
    reqDays,
    designDays,
    devDays,
    testDays,
    actualReportDays,
    addedCodeLines,
    deletedCodeLines,
    unsaved,
    unsavedMessage,
    rows,
    totalTypeRatio,
    totalTypeWorkload,
    uniqueMemberCount: uniqueMembers.size,
    totalPersonalRatio,
    totalPersonalWorkload,
  };
}
