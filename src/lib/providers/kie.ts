// مزود kie.ai — Jobs API الموحد وفق https://docs.kie.ai
// createTask: POST /api/v1/jobs/createTask  → {"code":200,"data":{"taskId":"..."}}
// recordInfo: GET  /api/v1/jobs/recordInfo?taskId=...
//   → {"code":200,"data":{"state":"waiting|queuing|generating|success|fail","resultJson":"{\"resultUrls\":[...]}","failMsg":"..."}}
import { ProviderError, type CheckResult, type KeyRef, type ProviderAdapter } from "./types";

const KIE_BASE = "https://api.kie.ai";
const CREATE_TIMEOUT = 30_000;
const CHECK_TIMEOUT = 20_000;

function authHeaders(key: KeyRef): Record<string, string> {
  return { Authorization: `Bearer ${key.api_key}`, "Content-Type": "application/json" };
}

// kie قد يعيد HTTP 200 مع code داخل الجسم (أو العكس) — نوحّد الحالة قبل التصنيف
async function parseKie(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  let json: Record<string, any>;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(res.status, text.slice(0, 300) || `HTTP ${res.status}`);
  }
  const bodyCode = typeof json?.code === "number" ? json.code : undefined;
  const effective = res.ok ? (bodyCode ?? 200) : res.status;
  if (effective !== 200 || (!res.ok && res.status >= 400)) {
    const msg = json?.msg ?? json?.message ?? text.slice(0, 300);
    throw new ProviderError(effective >= 400 ? effective : res.status || 500, String(msg || `HTTP ${res.status}`));
  }
  return json;
}

export const kieAdapter: ProviderAdapter = {
  async createTask(key, model, input) {
    const res = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(CREATE_TIMEOUT),
    });
    const json = await parseKie(res);
    const taskId = json?.data?.taskId;
    if (!taskId) throw new ProviderError(500, "استجابة createTask بلا data.taskId");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(key, providerTaskId) {
    const res = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    const json = await parseKie(res);
    const data = json?.data ?? {};
    const state = String(data.state ?? "").toLowerCase();

    // resultJson نص JSON داخل JSON — يحتاج JSON.parse ثانيًا
    let urls: string[] | undefined;
    try {
      if (data.resultJson) {
        const inner = JSON.parse(String(data.resultJson));
        const arr = inner?.resultUrls ?? inner?.result_urls;
        if (Array.isArray(arr) && arr.length) urls = arr.map(String);
      }
    } catch {
      // نتجاهل ونعتمد الحقول المباشرة إن وُجدت
    }
    if (!urls && Array.isArray(data.resultUrls) && data.resultUrls.length) {
      urls = data.resultUrls.map(String);
    }

    if (state === "success") {
      if (!urls?.length) return { status: "failed", error: "اكتملت المهمة لدى المزود دون روابط نتيجة" };
      return { status: "completed", urls, progress: 100 };
    }
    if (state === "fail") {
      return { status: "failed", error: String(data.failMsg || json?.msg || "فشل المزود دون تفاصيل") };
    }
    // waiting | queuing | generating — تقدير تقدم تقريبي للحالات الوسيطة
    const progress = state === "generating" ? 60 : state === "queuing" ? 20 : 10;
    return { status: "processing", progress };
  },
};
