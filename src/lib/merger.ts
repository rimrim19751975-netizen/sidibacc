// عميل خدمة دمج الفيديو — Video Merger API v2 (المواصفة §7)
// بلا مفاتيح أو توثيق. العنوان من MERGER_API_BASE. المخرجات MP4 (H.264 + AAC) حتى 1080p بجودة CRF 18.
// القيود: 10 مقاطع كحد أقصى، 200MB لكل مصدر، 150MB للناتج، 600 ثانية مجموع المدد، حذف تلقائي بعد 24 ساعة.
const MERGER_BASE = (process.env.MERGER_API_BASE || "").trim().replace(/\/+$/, "");

export class MergerError extends Error {
  status?: number;
  notFound: boolean; // 404 — المهمة غير موجودة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)
  final: boolean; // أخطاء HTTP المعلنة من الخدمة حتمية — لا إعادة محاولة؛ أخطاء شبكتنا مؤقتة
  constructor(message: string, opts?: { status?: number; notFound?: boolean; final?: boolean }) {
    super(message);
    this.name = "MergerError";
    this.status = opts?.status;
    this.notFound = opts?.notFound ?? false;
    this.final = opts?.final ?? true;
  }
}

export function mergerConfigured(): boolean {
  return MERGER_BASE.length > 0;
}

export function mergerBase(): string {
  return MERGER_BASE;
}

// توكن حماية اختياري لخدمة الدمج — يُرسل تلقائيًا إن ضُبط MERGER_TOKEN (الخدمة تفرضه إن ضبطت هي الأخرى)
const MERGER_TOKEN = (process.env.MERGER_TOKEN || "").trim();

function mergerHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (MERGER_TOKEN) h["Authorization"] = `Bearer ${MERGER_TOKEN}`;
  return h;
}

async function mergerFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Record<string, any> | null> {
  let res: Response;
  try {
    res = await fetch(`${MERGER_BASE}${path}`, {
      ...init,
      headers: { ...mergerHeaders(), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // timeout/fetch — أخطاء شبكتنا نحن: مؤقتة وليست حتمية
    throw new MergerError(`تعذر الوصول لخدمة الدمج: ${String((err as Error)?.message ?? err)}`, { final: false });
  }
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    // أي خطأ HTTP معلن من الخدمة (4xx/5xx بجسم error) = فشل نهائي فوري
    const msg = json?.error ?? text.slice(0, 300) ?? `HTTP ${res.status}`;
    throw new MergerError(String(msg), { status: res.status, notFound: res.status === 404, final: true });
  }
  return json;
}

export interface MergeJob {
  jobId: string;
  status: string;
}

// POST /api/jobs — إنشاء مهمة دمج من روابط مباشرة
export async function createJob(videos: string[]): Promise<MergeJob> {
  const json = await mergerFetch(
    "/api/jobs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos }) },
    30_000,
  );
  const jobId = json?.jobId;
  if (!jobId) throw new MergerError("استجابة إنشاء مهمة الدمج بلا jobId", { final: true });
  return { jobId: String(jobId), status: String(json?.status ?? "queued") };
}

// POST /api/jobs/{id}/process — يستغرق ~10–15 ثانية (blocking)
export async function processJob(jobId: string): Promise<Record<string, any> | null> {
  return mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}/process`, { method: "POST" }, 180_000);
}

export interface MergeStatus {
  status: "queued" | "processing" | "done" | "failed";
  progress: number;
  videoUrl?: string;
  downloadUrl?: string;
  error?: string;
}

// تحليل دفاعي للحالة: done|completed|complete|success|succeeded|finished = نجاح،
// error|failed|failure|cancelled = فشل، وقد يرد الجسم فيه error بدون status → فشل فوري.
export function parseMergeStatus(json: Record<string, any> | null, jobId: string): MergeStatus {
  const raw = String(json?.status ?? "").toLowerCase();
  const hasError = typeof json?.error === "string" && json.error.trim().length > 0;
  const okWords = /^(done|completed|complete|success|succeeded|finished)$/;
  const failWords = /^(error|failed|failure|cancelled|canceled)$/;

  if (hasError && !okWords.test(raw)) {
    return { status: "failed", progress: 0, error: json.error };
  }
  if (okWords.test(raw)) {
    // رابط النتيجة: فضّل videoUrl ثم downloadUrl ثم fallback على /api/jobs/{id}/video
    const videoUrl = typeof json?.videoUrl === "string" && json.videoUrl ? json.videoUrl : undefined;
    const downloadUrl = typeof json?.downloadUrl === "string" && json.downloadUrl ? json.downloadUrl : undefined;
    return { status: "done", progress: 100, videoUrl, downloadUrl };
  }
  if (failWords.test(raw)) {
    return { status: "failed", progress: 0, error: json?.error ?? "فشل الدمج دون تفاصيل" };
  }
  // queued | pending | processing | غير معروف
  let progress = typeof json?.progress === "number" ? json.progress : 0;
  if (progress > 0 && progress <= 1) progress = progress * 100; // قد يأتي كسرًا 0..1
  return { status: /^(queued|queue|pending|waiting)$/.test(raw) ? "queued" : "processing", progress };
}

// GET /api/jobs/{id}
export async function getJobStatus(jobId: string): Promise<MergeStatus> {
  const json = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, 20_000);
  return parseMergeStatus(json, jobId);
}

// رابط النتيجة النهائي مع الـ fallback الموثوق
export function resultUrlOf(st: MergeStatus, jobId: string): string {
  return st.videoUrl || st.downloadUrl || `${MERGER_BASE}/api/jobs/${encodeURIComponent(jobId)}/video`;
}

// DELETE /api/jobs/{id} — تنظيف اختياري
export async function deleteJob(jobId: string): Promise<boolean> {
  try {
    await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, 15_000);
    return true;
  } catch {
    return false;
  }
}

// GET /api/config — فحص جهوزية الخدمة (مهلة 4 ثوانٍ) — يُرسل الترويسة أيضًا لأن الخدمة المحمية ترفض النداءات البلا توكن
export async function mergerHealthy(): Promise<boolean> {
  if (!mergerConfigured()) return false;
  try {
    const res = await fetch(`${MERGER_BASE}/api/config`, {
      headers: mergerHeaders(),
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
