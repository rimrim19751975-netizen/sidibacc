// طبقة قاعدة البيانات — Turso (libSQL) عبر HTTP فقط (توافق Vercel/serverless، بلا ملفات محلية)
import { createClient, type Client, type InValue } from "@libsql/client";
import type { AttemptEntry } from "./providers/types";
import type { MediaType } from "./models";

let client: Client | null = null;
let schemaPromise: Promise<void> | null = null;

export type TaskStatus = "pending" | "processing" | "completed" | "failed";

export interface TaskRow {
  id: string;
  provider: string | null;
  provider_task_id: string | null;
  key_id: string | null;
  model: string;
  type: MediaType;
  prompt: string;
  params_json: string;
  status: TaskStatus;
  progress: number;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// عميل واحد يُعاد استخدامه بين الطلبات في نفس النسخة
export function getTurso(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) {
      // إلزامي: TURSO_DATABASE_URL — قاعدة Turso عبر HTTP في الإنتاج (توافق Vercel)
      throw new Error("متغير TURSO_DATABASE_URL مطلوب");
    }
    // التوكن إلزامي مع Turso السحابية؛ قبول غيابه فقط مع قاعدة محلية file: للاختبار المحلي
    const authToken = process.env.TURSO_AUTH_TOKEN;
    client = authToken ? createClient({ url, authToken }) : createClient({ url });
  }
  return client;
}

// إنشاء الجداول عند أول وصول (CREATE TABLE IF NOT EXISTS) — بلا أداة migrations
export async function ensureSchema(): Promise<void> {
  schemaPromise ??= (async () => {
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      provider TEXT,
      provider_task_id TEXT,
      key_id TEXT,
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      params_json TEXT DEFAULT '{}',
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      result_urls_json TEXT,
      error_message TEXT,
      attempts_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    // فهارس خفيفة: أحدث المهام وترتيب المفاتيح التسلسلي
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created_at)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_keys_order ON api_keys (provider, created_at)`);
  })();
  return schemaPromise;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await ensureSchema();
    await getTurso().execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/* ---------- تحويل الصفوف ---------- */

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

function mapTaskRow(r: Record<string, unknown>): TaskRow {
  return {
    id: str(r.id),
    provider: strOrNull(r.provider),
    provider_task_id: strOrNull(r.provider_task_id),
    key_id: strOrNull(r.key_id),
    model: str(r.model),
    type: (str(r.type) || "image") as MediaType,
    prompt: str(r.prompt),
    params_json: str(r.params_json) || "{}",
    status: (str(r.status) || "processing") as TaskStatus,
    progress: Number(r.progress ?? 0) || 0,
    result_urls_json: strOrNull(r.result_urls_json),
    error_message: strOrNull(r.error_message),
    attempts_json: str(r.attempts_json) || "[]",
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    completed_at: strOrNull(r.completed_at),
  };
}

/* ---------- عمليات المهام ---------- */

export interface InsertTaskInput {
  id: string;
  model: string;
  type: MediaType;
  prompt: string;
  params: Record<string, unknown>;
}

// تُسجَّل المهمة قبل أي نداء خارجي — تبقى قابلة للتتبع حتى لو انقطع الاتصال
export async function insertTask(t: InsertTaskInput): Promise<TaskRow> {
  await ensureSchema();
  const now = nowIso(); // ISO بالمللي ثانية لضمان الترتيب التسلسلي الدقيق للمفاتيح
  await getTurso().execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status, progress, result_urls_json, error_message, attempts_json, created_at, updated_at)
          VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, 'processing', 0, NULL, NULL, '[]', ?, ?)`,
    args: [t.id, t.model, t.type, t.prompt, JSON.stringify(t.params ?? {}), now, now],
  });
  return (await getTask(t.id))!;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ensureSchema();
  const rs = await getTurso().execute({ sql: "SELECT * FROM tasks WHERE id = ? LIMIT 1", args: [id] });
  return rs.rows.length ? mapTaskRow(rs.rows[0] as Record<string, unknown>) : null;
}

export interface TaskPatch {
  provider?: string | null;
  provider_task_id?: string | null;
  key_id?: string | null;
  status?: TaskStatus;
  progress?: number;
  result_urls?: string[];
  error_message?: string | null;
  append_attempts?: AttemptEntry[];
  params?: Record<string, unknown>;
  // تحديث مشروط: لا يُطبَّق إلا إذا كانت حالة المهمة الحالية مطابقة (يمنع إحياء مهمة فاشلة)
  expectStatus?: TaskStatus;
}

// تحديث جزئي: يضيف المحاولات إلى السجل ويثبت completed_at تلقائيًا عند الاكتمال
export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRow | null> {
  await ensureSchema();
  const sets: string[] = [];
  const args: InValue[] = [];
  const put = (col: string, v: InValue) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.provider !== undefined) put("provider", patch.provider);
  if (patch.provider_task_id !== undefined) put("provider_task_id", patch.provider_task_id);
  if (patch.key_id !== undefined) put("key_id", patch.key_id);
  if (patch.status !== undefined) put("status", patch.status);
  if (patch.progress !== undefined) put("progress", Math.max(0, Math.min(100, Math.round(patch.progress))));
  if (patch.result_urls !== undefined) put("result_urls_json", JSON.stringify(patch.result_urls));
  if (patch.error_message !== undefined) put("error_message", patch.error_message);
  if (patch.params !== undefined) put("params_json", JSON.stringify(patch.params));
  if (patch.append_attempts?.length) {
    const cur = await getTask(id);
    const arr: AttemptEntry[] = cur ? safeParseArray(cur.attempts_json) : [];
    arr.push(...patch.append_attempts);
    put("attempts_json", JSON.stringify(arr));
  }
  if (patch.status === "completed") {
    put("completed_at", nowIso());
    if (patch.progress === undefined) put("progress", 100);
  }
  put("updated_at", nowIso());
  if (patch.expectStatus) {
    // تحديث مشروط بالحالة — يمنع سباقات الإحياء بين استعلامات get_task المتوازية
    const rs = await getTurso().execute({
      sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
      args: [...args, id, patch.expectStatus],
    });
    if (rs.rowsAffected === 0) return getTask(id);
  } else {
    await getTurso().execute({ sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  }
  return getTask(id);
}

export async function listRecentTasks(limit: number, filter?: { type?: string; status?: string }): Promise<TaskRow[]> {
  await ensureSchema();
  const clauses: string[] = [];
  const args: InValue[] = [];
  if (filter?.type) {
    clauses.push("type = ?");
    args.push(filter.type);
  }
  if (filter?.status) {
    clauses.push("status = ?");
    args.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  args.push(Math.max(1, Math.min(100, limit)));
  const rs = await getTurso().execute({
    sql: `SELECT * FROM tasks ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    args,
  });
  return rs.rows.map((r) => mapTaskRow(r as Record<string, unknown>));
}

export interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

export async function taskStats(): Promise<TaskStats> {
  await ensureSchema();
  const rs = await getTurso().execute(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN status IN ('processing','pending') THEN 1 ELSE 0 END) AS processing
    FROM tasks`);
  const r = (rs.rows[0] ?? {}) as Record<string, unknown>;
  return {
    total: Number(r.total ?? 0) || 0,
    completed: Number(r.completed ?? 0) || 0,
    failed: Number(r.failed ?? 0) || 0,
    processing: Number(r.processing ?? 0) || 0,
  };
}

export async function deleteTasks(ids: string[]): Promise<void> {
  await ensureSchema();
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  await getTurso().execute({ sql: `DELETE FROM tasks WHERE id IN (${ph})`, args: ids });
}

/* ---------- مساعدات تحليل الأعمدة ---------- */

export function resultUrlsOf(row: TaskRow): string[] {
  try {
    const v = JSON.parse(row.result_urls_json ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function attemptsOf(row: TaskRow): AttemptEntry[] {
  return safeParseArray(row.attempts_json);
}

function safeParseArray(s: string): AttemptEntry[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
