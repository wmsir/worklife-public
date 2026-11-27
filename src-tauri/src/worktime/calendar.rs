use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};
use serde_json::{json, Value};

const WEEKDAY_NAMES: [&str; 7] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const CN_HOLIDAYS: &[(&str, &str)] = &[
    // 2024
    ("2024-01-01", "元旦"),
    ("2024-02-10", "春节"),
    ("2024-02-11", "春节"),
    ("2024-02-12", "春节"),
    ("2024-02-13", "春节"),
    ("2024-02-14", "春节"),
    ("2024-02-15", "春节"),
    ("2024-02-16", "春节"),
    ("2024-02-17", "春节"),
    ("2024-04-04", "清明节"),
    ("2024-04-05", "清明节"),
    ("2024-04-06", "清明节"),
    ("2024-05-01", "劳动节"),
    ("2024-05-02", "劳动节"),
    ("2024-05-03", "劳动节"),
    ("2024-05-04", "劳动节"),
    ("2024-05-05", "劳动节"),
    ("2024-06-10", "端午节"),
    ("2024-09-15", "中秋节"),
    ("2024-09-16", "中秋节"),
    ("2024-09-17", "中秋节"),
    ("2024-10-01", "国庆节"),
    ("2024-10-02", "国庆节"),
    ("2024-10-03", "国庆节"),
    ("2024-10-04", "国庆节"),
    ("2024-10-05", "国庆节"),
    ("2024-10-06", "国庆节"),
    ("2024-10-07", "国庆节"),
    // 2025
    ("2025-01-01", "元旦"),
    ("2025-01-28", "春节"),
    ("2025-01-29", "春节"),
    ("2025-01-30", "春节"),
    ("2025-01-31", "春节"),
    ("2025-02-01", "春节"),
    ("2025-02-02", "春节"),
    ("2025-02-03", "春节"),
    ("2025-02-04", "春节"),
    ("2025-04-04", "清明节"),
    ("2025-04-05", "清明节"),
    ("2025-04-06", "清明节"),
    ("2025-05-01", "劳动节"),
    ("2025-05-02", "劳动节"),
    ("2025-05-03", "劳动节"),
    ("2025-05-04", "劳动节"),
    ("2025-05-05", "劳动节"),
    ("2025-05-31", "端午节"),
    ("2025-06-01", "端午节"),
    ("2025-06-02", "端午节"),
    ("2025-10-01", "国庆节"),
    ("2025-10-02", "国庆节"),
    ("2025-10-03", "国庆节"),
    ("2025-10-04", "国庆节"),
    ("2025-10-05", "国庆节"),
    ("2025-10-06", "中秋节"),
    ("2025-10-07", "国庆节"),
    ("2025-10-08", "国庆节"),
    // 2026
    ("2026-01-01", "元旦"),
    ("2026-01-02", "元旦"),
    ("2026-01-03", "元旦"),
    ("2026-02-15", "春节"),
    ("2026-02-16", "春节"),
    ("2026-02-17", "春节"),
    ("2026-02-18", "春节"),
    ("2026-02-19", "春节"),
    ("2026-02-20", "春节"),
    ("2026-02-21", "春节"),
    ("2026-02-22", "春节"),
    ("2026-02-23", "春节"),
    ("2026-04-04", "清明节"),
    ("2026-04-05", "清明节"),
    ("2026-04-06", "清明节"),
    ("2026-05-01", "劳动节"),
    ("2026-05-02", "劳动节"),
    ("2026-05-03", "劳动节"),
    ("2026-05-04", "劳动节"),
    ("2026-05-05", "劳动节"),
    ("2026-06-19", "端午节"),
    ("2026-06-20", "端午节"),
    ("2026-06-21", "端午节"),
    ("2026-09-25", "中秋节"),
    ("2026-09-26", "中秋节"),
    ("2026-09-27", "中秋节"),
    ("2026-10-01", "国庆节"),
    ("2026-10-02", "国庆节"),
    ("2026-10-03", "国庆节"),
    ("2026-10-04", "国庆节"),
    ("2026-10-05", "国庆节"),
    ("2026-10-06", "国庆节"),
    ("2026-10-07", "国庆节"),
];

const CN_IN_LIEU_WORKDAYS: &[&str] = &[
    // 2024
    "2024-02-04",
    "2024-02-18",
    "2024-04-07",
    "2024-04-28",
    "2024-05-11",
    "2024-09-14",
    "2024-09-29",
    "2024-10-12",
    // 2025
    "2025-01-26",
    "2025-02-08",
    "2025-04-27",
    "2025-09-28",
    "2025-10-11",
    // 2026
    "2026-01-04",
    "2026-02-14",
    "2026-02-28",
    "2026-05-09",
    "2026-09-20",
    "2026-10-10",
];

pub fn get_day_info(d: NaiveDate) -> Value {
    let wd_idx = d.weekday().num_days_from_monday() as usize;
    let weekday_str = WEEKDAY_NAMES[wd_idx];
    let ymd = d.format("%Y-%m-%d").to_string();

    if let Some((_, cn_name)) = CN_HOLIDAYS.iter().find(|(k, _)| *k == ymd) {
        return json!({
            "is_workday": false,
            "day_type": "holiday",
            "label": format!("🎉 {cn_name}"),
            "holiday_name": cn_name,
            "weekday_str": weekday_str,
        });
    }

    if CN_IN_LIEU_WORKDAYS.contains(&ymd.as_str()) {
        return json!({
            "is_workday": true,
            "day_type": "in_lieu",
            "label": "调休补班",
            "weekday_str": weekday_str,
        });
    }

    if wd_idx < 5 {
        json!({
            "is_workday": true,
            "day_type": "workday",
            "label": "工作日",
            "weekday_str": weekday_str,
        })
    } else {
        json!({
            "is_workday": false,
            "day_type": "weekend",
            "label": "🏖️ 周末",
            "weekday_str": weekday_str,
        })
    }
}

pub fn is_cn_workday(d: NaiveDate) -> bool {
    get_day_info(d)
        .get("is_workday")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn get_quarter(year: i32, month: u32) -> (u32, u32) {
    if year == 2026 && (6..=9).contains(&month) {
        return (6, 9);
    }
    match month {
        1..=3 => (1, 3),
        4..=6 => (4, 6),
        7..=9 => (7, 9),
        _ => (10, 12),
    }
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_first = NaiveDate::from_ymd_opt(ny, nm, 1).expect("valid date");
    next_first
        .pred_opt()
        .expect("valid pred")
        .day()
}

pub fn local_midnight_ms(d: NaiveDate) -> i64 {
    let ndt = d.and_hms_opt(0, 0, 0).expect("midnight");
    Local
        .from_local_datetime(&ndt)
        .earliest()
        .or_else(|| Local.from_local_datetime(&ndt).latest())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| ndt.and_utc().timestamp_millis())
}

pub fn local_end_of_day_ms(d: NaiveDate) -> i64 {
    let ndt = d.and_hms_opt(23, 59, 59).expect("end of day");
    Local
        .from_local_datetime(&ndt)
        .earliest()
        .or_else(|| Local.from_local_datetime(&ndt).latest())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| ndt.and_utc().timestamp_millis())
}

pub fn ms_to_local_ymd(ms: i64) -> Option<String> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .or_else(|| Local.timestamp_millis_opt(ms).earliest())
        .map(|dt| dt.format("%Y-%m-%d").to_string())
}

pub fn date_str_to_ms(date_str: &str) -> Result<i64, String> {
    let clean = date_str.trim().replace('/', "-");
    let d = NaiveDate::parse_from_str(&clean, "%Y-%m-%d")
        .map_err(|e| format!("无效日期格式 '{date_str}': {e}"))?;
    Ok(local_midnight_ms(d))
}

pub fn calculate_plan_test_date(
    start_date: Option<NaiveDate>,
    workdays: usize,
) -> (String, i64, String) {
    let mut curr = start_date.unwrap_or_else(|| Local::now().date_naive());
    let mut added = 0usize;
    while added < workdays {
        curr += Duration::days(1);
        if is_cn_workday(curr) {
            added += 1;
        }
    }
    let ymd = curr.format("%Y-%m-%d").to_string();
    let ts_ms = local_midnight_ms(curr);
    (ymd.clone(), ts_ms, ymd)
}
