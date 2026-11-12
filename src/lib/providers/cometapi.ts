// مزود CometAPI — وفق التوثيق الرسمي الحالي https://apidoc.cometapi.com
// الصور: POST /v1/images/generations (متوافق OpenAI) — يعيد data فورًا أو task_id لمهمة غير متزامنة
//        والاستعلام: GET /v1/images/generations/{task_id}
// فيديو Grok: POST /grok/v1/videos/generations → {"request_id":"..."}
//        الاستعلام: GET /grok/v1/videos/{request_id} → {status: pending|done|failed|expired, progress, video:{url}, error}
// فيديو Seedance (الأسرع): POST /v1/videos (multipart/form-data) → {"id":"task_...","status":"queued"}
//        الاستعلام: GET /v1/videos/{id} → {status: queued|in_progress|completed|failed|error, progress, video_url}
//        يُخزَّن معرف المهمة بالبادئة "seedance:" لتمييز عائلة الاستعلام عند checkTask
import { ProviderError, type CheckResult, type KeyRef, type ProviderAdapter } from "./types";

// يمكن تجاوز العنوان الأساسي عبر البيئة إن لزم
const COMET_BASE = (process.env.COMETAPI_BASE_URL || "https://api.cometapi.com").replace(/\/+$/, "");
const CREATE_TIMEOUT = 30_000;
const CHECK_TIMEOUT = 20_000;
const IMAGE_SYNC_POLL_MS = 3_000;
const IMAGE_SYNC_MAX_MS = 150_000;
// حارس الرصيد: CometAPI تحتسب مقدمًا (pre-consume) السعر الكامل للفيديو قبل بدئه —
// المُختبر فعليًا: 15 ثانية → ＄1.62 و8 ثوانٍ → ＄0.84 (≈ ＄0.105/ثانية بغضّ النظر عن حجم الطلب).
// سقف 5 ثوانٍ (≈ ＄0.52) يجعل الفيديو يمرّ مع الأرصدة المجانية الصغيرة —
// ارفع السقف بمتغير البيئة COMETAPI_MAX_VIDEO_SECONDS عند توفر رصيد أكبر.
const MAX_VIDEO_SECONDS = (() => {
  const v = Number(process.env.COMETAPI_MAX_VIDEO_SECONDS);
  return Number.isFinite(v) && v >= 4 ? Math.min(15, Math.round(v)) : 5;
})();
// 480p دائمًا افتراضيًا (720p يضاعف السعر) — فعّل COMETAPI_ALLOW_720P=1 للسماح بـ 720p عند توفر رصيد كافٍ
const ALLOW_720P = process.env.COMETAPI_ALLOW_720P === "1";

function authHeaders(key: KeyRef): Record<string, string> {
  return { Authorization: `Bearer ${key.api_key}`, "Content-Type": "application/json" };
}

async function parseComet(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  let json: Record<string, any>;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(res.status, text.slice(0, 300) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const raw = json?.error?.message ?? json?.message ?? json?.error ?? text.slice(0, 300);
    const msg = typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 300);
    throw new ProviderError(res.status, msg || `HTTP ${res.status}`);
  }
  return json;
}

// أبعاد الصور المتوافقة مع OpenAI (gpt-image) من نسبة الأبعاد
function sizeFromAspect(aspect?: string): string | null {
  switch (aspect) {
    case "1:1":
      return "1024x1024";
    case "3:2":
    case "4:3":
    case "5:4":
    case "16:9":
    case "2:1":
    case "21:9":
    case "3:1":
      return "1536x1024";
    case "2:3":
    case "3:4":
    case "4:5":
    case "9:16":
    case "1:2":
    case "9:21":
    case "1:3":
      return "1024x1536";
    default:
      return null; // auto — لا نرسل size إطلاقًا
  }
}

function urlsFromData(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const urls: string[] = [];
  for (const item of data as Record<string, unknown>[]) {
    if (typeof item?.url === "string" && item.url) urls.push(item.url);
    else if (typeof item?.b64_json === "string" && item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
  }
  return urls;
}

/* ---------- Seedance (POST /v1/videos، multipart) ---------- */

const SEEDANCE_PREFIX = "seedance:";

// جدول المقاسات الدقيقة الوثّقية لعائلة Seedance 2.0 (Fast/Mini/1.5/2.0) — 480p و720p فقط
const SEEDANCE_SIZES: Record<string, Record<string, string>> = {
  "480p": { "16:9": "864x496", "4:3": "752x560", "1:1": "640x640", "3:4": "560x752", "9:16": "496x864", "21:9": "992x432" },
  "720p": { "16:9": "1280x720", "4:3": "1112x834", "1:1": "960x960", "3:4": "834x1112", "9:16": "720x1280", "21:9": "1470x630" },
};

function seedanceSize(aspect?: unknown, resolution?: unknown): string {
  const ar = typeof aspect === "string" && SEEDANCE_SIZES["480p"][aspect] ? aspect : "16:9";
  const res = resolution === "720p" ? "720p" : "480p"; // Fast يدعم 480p/720p فقط — نُنزّل 1080p تلقائيًا
  return SEEDANCE_SIZES[res][ar];
}

async function seedanceCreate(key: KeyRef, model: string, input: Record<string, unknown>): Promise<{ providerTaskId: string }> {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", String(input.prompt ?? ""));
  const duration = typeof input.duration === "number" && input.duration >= 2 ? Math.round(input.duration) : 5;
  fd.append("seconds", String(Math.min(MAX_VIDEO_SECONDS, Math.max(4, duration)))); // حارس الرصيد: سقف المدة
  fd.append("size", seedanceSize(input.aspect_ratio, ALLOW_720P ? input.resolution : "480p"));
  if (typeof input.image_url === "string" && input.image_url) {
    fd.append("input_reference", input.image_url); // image-to-video عبر رابط عام مباشر
  }
  const res = await fetch(`${COMET_BASE}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.api_key}` }, // content-type مع boundary يضبطه fetch تلقائيًا
    body: fd,
    signal: AbortSignal.timeout(CREATE_TIMEOUT),
  });
  const json = await parseComet(res);
  const id = json?.id ?? json?.task_id;
  if (!id) throw new ProviderError(500, "استجابة إنشاء Seedance بلا معرّف مهمة");
  return { providerTaskId: `${SEEDANCE_PREFIX}${String(id)}` };
}

async function seedanceCheck(key: KeyRef, providerTaskId: string): Promise<CheckResult> {
  const id = providerTaskId.slice(SEEDANCE_PREFIX.length);
  const res = await fetch(`${COMET_BASE}/v1/videos/${encodeURIComponent(id)}`, {
    headers: authHeaders(key),
    signal: AbortSignal.timeout(CHECK_TIMEOUT),
  });
  const json = await parseComet(res);
  const status = String(json?.status ?? "queued").toLowerCase();
  const progress = typeof json?.progress === "number" ? json.progress : undefined;
  if (status === "completed") {
    const url = json?.video_url;
    if (!url) return { status: "failed", error: "اكتملت المهمة لدى المزود دون رابط فيديو" };
    return { status: "completed", urls: [String(url)], progress: 100 };
  }
  if (status === "failed" || status === "error") {
    const raw = typeof json?.error === "string" ? json.error : json?.error ? JSON.stringify(json.error) : json?.message ?? "فشل المزود دون تفاصيل";
    return { status: "failed", error: String(raw) };
  }
  // queued | in_progress
  return { status: "processing", progress: progress ?? (status === "in_progress" ? 40 : 15) };
}

export const cometApiAdapter: ProviderAdapter = {
  // صور CometAPI تُعالج "تزامنيًا" من وجهة نظر المنسّق: نتيجة فورية أو استقصاء قصير لمهمة
  async createImageSync(key, model, input) {
    const body: Record<string, unknown> = { model, prompt: String(input.prompt ?? "") };
    const size = sizeFromAspect(typeof input.aspect_ratio === "string" ? input.aspect_ratio : undefined);
    if (size) body.size = size;

    const res = await fetch(`${COMET_BASE}/v1/images/generations`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CREATE_TIMEOUT),
    });
    let json = await parseComet(res);
    let urls = urlsFromData(json?.data);
    if (urls.length) return { urls };

    // بعض الموديلات تعيد مهمة غير متزامنة (task_id) — نستعلمها حتى السقف
    const taskId = json?.task_id ?? json?.id;
    if (taskId) {
      const deadline = Date.now() + IMAGE_SYNC_MAX_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, IMAGE_SYNC_POLL_MS));
        const r2 = await fetch(`${COMET_BASE}/v1/images/generations/${encodeURIComponent(String(taskId))}`, {
          headers: authHeaders(key),
          signal: AbortSignal.timeout(CHECK_TIMEOUT),
        });
        json = await parseComet(r2);
        urls = urlsFromData(json?.data ?? json?.result?.data);
        if (urls.length) return { urls };
        if (json?.status === "failed" || json?.error) {
          const raw = json?.error?.message ?? json?.error ?? "فشلت مهمة الصورة لدى المزود";
          throw new ProviderError(500, typeof raw === "string" ? raw : JSON.stringify(raw));
        }
      }
      throw new ProviderError(408, "انتهت مهلة استعلام مهمة الصورة لدى CometAPI");
    }
    throw new ProviderError(500, "استجابة صور غير متوقعة من CometAPI");
  },

  async createTask(key, model, input) {
    // عائلة Seedance عبر /v1/videos (multipart) — الأسرع؛ ما عدا ذلك → Grok عبر /grok/v1/videos/generations
    if (/^(doubao-)?seedance/.test(model)) return seedanceCreate(key, model, input);
    // فيديو Grok: الصورة الأولى تمرر داخل كائن image.url وفق التوثيق
    // حارس الرصيد هنا أيضًا: grok يُحاسَب مقدمًا بالثانية — سقف المدة نفسه يحمي الأرصدة الصغيرة
    const body: Record<string, unknown> = { model, prompt: String(input.prompt ?? "") };
    if (typeof input.duration === "number") {
      body.duration = Math.min(MAX_VIDEO_SECONDS, Math.max(4, Math.round(input.duration)));
    }
    if (typeof input.aspect_ratio === "string" && input.aspect_ratio !== "auto") body.aspect_ratio = input.aspect_ratio;
    if (typeof input.resolution === "string" && input.resolution !== "auto") body.resolution = input.resolution;
    if (typeof input.image_url === "string" && input.image_url) body.image = { url: input.image_url };

    const res = await fetch(`${COMET_BASE}/grok/v1/videos/generations`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CREATE_TIMEOUT),
    });
    const json = await parseComet(res);
    const requestId = json?.request_id ?? json?.requestId ?? json?.id;
    if (!requestId) throw new ProviderError(500, "استجابة إنشاء الفيديو بلا request_id");
    return { providerTaskId: String(requestId) };
  },

  async checkTask(key, providerTaskId) {
    // مهام Seedance تُخزَّن ببادئة seedance: — تُستعلم من /v1/videos/{id}
    if (providerTaskId.startsWith(SEEDANCE_PREFIX)) return seedanceCheck(key, providerTaskId);
    const res = await fetch(`${COMET_BASE}/grok/v1/videos/${encodeURIComponent(providerTaskId)}`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    const json = await parseComet(res);
    const status = String(json?.status ?? "pending").toLowerCase();
    const progress = typeof json?.progress === "number" ? json.progress : undefined;
    const url = json?.video?.url;

    if (status === "done") {
      if (!url) return { status: "failed", error: "اكتملت المهمة لدى المزود دون رابط فيديو" };
      return { status: "completed", urls: [String(url)], progress: 100 };
    }
    if (status === "failed" || status === "expired") {
      const raw = typeof json?.error === "string" ? json.error : json?.error ? JSON.stringify(json.error) : "فشل المزود دون تفاصيل";
      return { status: "failed", error: raw };
    }
    return { status: "processing", progress: progress ?? 30 };
  },
};
