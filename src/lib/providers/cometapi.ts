// مزود CometAPI — وفق التوثيق الرسمي الحالي https://apidoc.cometapi.com
// الصور: POST /v1/images/generations (متوافق OpenAI) — يعيد data فورًا أو task_id لمهمة غير متزامنة
//        والاستعلام: GET /v1/images/generations/{task_id}
// فيديو Grok: POST /grok/v1/videos/generations → {"request_id":"..."}
//        الاستعلام: GET /grok/v1/videos/{request_id} → {status: pending|done|failed|expired, progress, video:{url}, error}
import { ProviderError, type CheckResult, type KeyRef, type ProviderAdapter } from "./types";

// يمكن تجاوز العنوان الأساسي عبر البيئة إن لزم
const COMET_BASE = (process.env.COMETAPI_BASE_URL || "https://api.cometapi.com").replace(/\/+$/, "");
const CREATE_TIMEOUT = 30_000;
const CHECK_TIMEOUT = 20_000;
const IMAGE_SYNC_POLL_MS = 3_000;
const IMAGE_SYNC_MAX_MS = 150_000;

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
    // فيديو Grok: الصورة الأولى تمرر داخل كائن image.url وفق التوثيق
    const body: Record<string, unknown> = { model, prompt: String(input.prompt ?? "") };
    if (typeof input.duration === "number") body.duration = input.duration;
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
