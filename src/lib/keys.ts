// نظام المفاتيح المتسلسلة — قلب المشروع (المواصفة §4)
import { getTurso, ensureSchema, nowIso } from "./turso";
import type { ProviderId } from "./models";
import type { ErrorClass } from "./providers/types";

export type KeyStatus = "active" | "exhausted" | "disabled";

export interface KeyRow {
  id: string;
  provider: ProviderId;
  label: string;
  api_key: string;
  status: KeyStatus;
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

// إخفاء المفتاح إلزامي في كل الاستجابات والسجلات — لا يُعاد المفتاح الكامل أبدًا
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 14) return `${key.slice(0, 3)}•••`;
  return `${key.slice(0, 7)}•••••••${key.slice(-4)}`;
}

// تصنيف أخطاء المزودين (جدول 4.2) — يحدد سياسة التبديل التسلسلي
export function classifyProviderError(status: number | undefined, message: string): ErrorClass {
  const s = status ?? 0;
  const m = (message || "").toLowerCase();
  const hit = (re: RegExp) => re.test(m);
  // إشارات صريحة قوية في الرسالة تتقدم على كود الحالة: بعض المزودين يلفّون
  // خطأ الرصيد/المفتاح داخل 429/5xx أو ردود WAF — مُختبر فعليًا مع kie.ai
  // ("Credits insufficient" تصل أحيانًا بحالة 500/429 فبقيت المفاتيح نشطة ظاهريًا)
  const strongAuth = hit(
    /invalid api key|incorrect api key|api key.{0,24}(invalid|incorrect|unauthorized|expired)|unauthorized|authentication|forbidden|signature invalid|المفتاح غير صالح/,
  );
  const strongBalance = hit(
    /insufficient|out of credits|balance (isn'?t|is not|no) enough|not enough (balance|credit)|please top up|top up to continue|余额不足|الرصيد غير كافٍ|نفد الرصيد|pre-?consume quota (failed|exceeded)|remaining quota|quota (failed|exceeded|insufficient)|need[:：]?\s*[＄$€]/,
  );
  // مفتاح مرفوض صراحةً في الرسالة → تعطيل تلقائي ثم الانتقال للمفتاح التالي
  if (strongAuth) return "disabled";
  // نفاد رصيد صريح بالرسالة — يتقدم على كل أكواد الحالة بما فيها 401/403:
  // CometAPI يلفّ خطأ الرصيد (pre-consume quota failed … need ＄X) داخل 403 —
  // لو عدّلناه disabled توقفت إعادة المحاولة للأبد رغم أن الشحن يحلّ المشكلة (مُختبر فعليًا 2026-11-12)
  if (strongBalance) return "exhausted";
  // مفتاح مرفوض بحالة HTTP بلا رسالة صريحة
  if (s === 401 || s === 403) return "disabled";
  // نفاد الرصيد الصريح 402
  if (s === 402) return "exhausted";
  // 429 و5xx بلا إشارة رصيد صريحة → مؤقتة دائمًا (تحديد المعدل لا يعني نفاد الرصيد)
  if (s === 429 || s >= 500) return "temporary";
  // نفاد الرصيد بالرسالة في أخطاء 4xx العادية — يُفحص قبل 400 لأن بعض المزودين يرسلونه بحالة 400
  if (hit(/quota|balance|credit|exhausted|充值/)) return "exhausted";
  // الموديل غير مدعوم لدى هذا المزود → ننتقل لمزود آخر
  if ((s === 400 || s === 404 || s === 422) && hit(/model not found|unsupported model/)) return "provider";
  // خطأ معطيات الطلب — توقف فورًا: تبديل المفاتيح لن يحلّه
  if (s === 400 || s === 422) return "params";
  // انقطاع الشبكة/timeout وغيرها → انتقال فوري للمفتاح التالي
  return "temporary";
}

// هل رسالة فشل منتصف المهمة تفضّ بمشكلة مفتاح/رصيد؟ (التبديل الصامت بنفس task_id)
export function isKeyOrBalanceError(message?: string | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return /insufficient|quota|balance|credit|out of credits|exhausted|充值|invalid api key|unauthorized|forbidden|authentication|\b401\b|\b402\b|\b403\b/.test(m);
}

function mapKeyRow(r: Record<string, unknown>): KeyRow {
  return {
    id: String(r.id),
    provider: String(r.provider) as ProviderId,
    label: String(r.label ?? ""),
    api_key: String(r.api_key ?? ""),
    status: (String(r.status ?? "active") as KeyStatus),
    usage_count: Number(r.usage_count ?? 0) || 0,
    success_count: Number(r.success_count ?? 0) || 0,
    fail_count: Number(r.fail_count ?? 0) || 0,
    last_used_at: r.last_used_at == null ? null : String(r.last_used_at),
    last_checked_at: r.last_checked_at == null ? null : String(r.last_checked_at),
    last_error: r.last_error == null ? null : String(r.last_error),
    created_at: String(r.created_at ?? ""),
  };
}

// الجلب التسلسلي الصارم: أول مفتاح أُضيف يُجرَّب أولًا (created_at ASC, id ASC) —
// هذا ليس round-robin وليس «الأقل استخدامًا أولًا». المستنزف (exhausted) يبقى في القائمة،
// والاستثناء الوحيد هو التعطيل اليدوي (disabled) من الواجهة.
export async function getKeyPool(providers: ProviderId[]): Promise<KeyRow[]> {
  await ensureSchema();
  if (!providers.length) return [];
  const ph = providers.map(() => "?").join(", ");
  const rs = await getTurso().execute({
    sql: `SELECT * FROM api_keys WHERE status != 'disabled' AND provider IN (${ph}) ORDER BY created_at ASC, id ASC`,
    args: [...providers],
  });
  return rs.rows.map((r) => mapKeyRow(r as Record<string, unknown>));
}

export async function listKeys(): Promise<KeyRow[]> {
  await ensureSchema();
  const rs = await getTurso().execute({
    sql: "SELECT * FROM api_keys ORDER BY created_at ASC, id ASC",
  });
  return rs.rows.map((r) => mapKeyRow(r as Record<string, unknown>));
}

export async function findKey(id: string): Promise<KeyRow | null> {
  await ensureSchema();
  const rs = await getTurso().execute({ sql: "SELECT * FROM api_keys WHERE id = ? LIMIT 1", args: [id] });
  return rs.rows.length ? mapKeyRow(rs.rows[0] as Record<string, unknown>) : null;
}

export type AddKeyResult =
  | { ok: true; key: KeyRow }
  | { ok: false; error: "invalid-provider" | "empty-key" | "duplicate" };

export async function addKey(provider: string, apiKey: string, label: string): Promise<AddKeyResult> {
  await ensureSchema();
  if (provider !== "kie" && provider !== "cometapi") return { ok: false, error: "invalid-provider" };
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "empty-key" };
  // رفض التكرار لنفس المزود
  const dup = await getTurso().execute({
    sql: "SELECT id FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1",
    args: [provider, key],
  });
  if (dup.rows.length) return { ok: false, error: "duplicate" };
  const id = crypto.randomUUID();
  await getTurso().execute({
    sql: "INSERT INTO api_keys (id, provider, label, api_key, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
    args: [id, provider, label.trim(), key, nowIso()],
  });
  return { ok: true, key: (await findKey(id))! };
}

// تحديث عدادات المفتاح بعد كل محاولة (نجاحًا أو فشلًا) مع انتقال الحالة التلقائي
export async function bumpKey(
  id: string,
  opts: { ok: boolean; errorClass?: ErrorClass; error?: string },
): Promise<void> {
  await ensureSchema();
  const now = nowIso();
  await getTurso().execute({
    sql: `UPDATE api_keys SET
      usage_count = usage_count + 1,
      success_count = success_count + ?,
      fail_count = fail_count + ?,
      last_used_at = ?,
      last_checked_at = ?,
      last_error = ?,
      status = CASE
        WHEN ? = 'disabled' THEN 'disabled'
        WHEN ? = 'exhausted' AND status = 'active' THEN 'exhausted'
        -- نجاح فعلي = المفتاح يعمل مجددًا: إعادة تعيين exhausted إلى active
        -- (disabled يدوي لا يُتجاوز أبدًا — قرار المستخدم محترم)
        WHEN ? = 1 AND status = 'exhausted' THEN 'active'
        ELSE status END
      WHERE id = ?`,
    args: [
      opts.ok ? 1 : 0,
      opts.ok ? 0 : 1,
      now,
      now,
      opts.error ?? null,
      opts.errorClass === "disabled" ? "disabled" : "",
      opts.errorClass === "exhausted" ? "exhausted" : "",
      opts.ok ? 1 : 0,
      id,
    ],
  });
}

// تعطيل/تنشيط يدوي من الواجهة (تنشيط مستنزف ممكن بعد إعادة الشحن)
export async function setKeyStatus(id: string, status: KeyStatus): Promise<boolean> {
  await ensureSchema();
  const rs = await getTurso().execute({
    sql: "UPDATE api_keys SET status = ? WHERE id = ?",
    args: [status, id],
  });
  return rs.rowsAffected > 0;
}

export async function deleteKey(id: string): Promise<boolean> {
  await ensureSchema();
  const rs = await getTurso().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}
