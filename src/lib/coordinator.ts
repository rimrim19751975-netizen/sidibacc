// منسّق التوليد والدمج — التبديل التسلسلي الصامت (المواصفة §4.3، §6، §7.3)
// القواعد الجوهرية:
// - لا تنزيل أي وسائط: روابط فقط.
// - أول مفتاح أُضيف يُجرَّب أولًا (created_at ASC) — ليس round-robin.
// - نفاد رصيد أو مفتاح مرفوض → انتقال فوري للمفتاح التالي واستئناف نفس المهمة بنفس task_id.
// - نموذج الذكاء الاصطناعي لا يرى أخطاء المفاتيح/الرصيد أبدًا.
// - فشل الإنشاء على كل المفاتيح → تبقى processing وتُعاد المحاولة مع كل get_task (تهدئة ~45 ثانية).
import { randomUUID } from "node:crypto";
import {
  insertTask,
  getTask,
  updateTask,
  listRecentTasks,
  resultUrlsOf,
  attemptsOf,
  nowIso,
  type TaskRow,
} from "./turso";
import { getKeyPool, findKey, bumpKey, classifyProviderError, isKeyOrBalanceError, type KeyRow } from "./keys";
import { resolveModel, defaultModelOfType, type ModelDef, type ProviderId } from "./models";
import { getAdapter, ProviderError, type AttemptEntry, type KeyRef } from "./providers";
import * as merger from "./merger";

// على Vercel تُقصّ نافذة الانتظار حتى يعيد الطلب task_id قبل سقف مدة الدالة (~60 ثانية)
const VERCEL = !!process.env.VERCEL;
const MAX_WINDOW_VERCEL = 50;
function effectiveWait(seconds: number): number {
  return VERCEL ? Math.min(seconds, MAX_WINDOW_VERCEL) : seconds;
}

const RETRY_COOLDOWN_MS = 45_000; // تهدئة إعادة محاولة الإنشاء عند نفاد المفاتيح
const POLL_INTERVAL_MS = 3_000; // كل 3 ثوانٍ أثناء نافذة الانتظار

// أقفال داخل النسخة الواحدة
const taskLocks = new Map<string, Promise<TaskRow | null>>();
const processInFlight = new Set<string>(); // منع تزامن خطوة process لخدمة الدمج

export class NoKeysError extends Error {
  model: string;
  constructor(model: string) {
    super(`لا توجد مفاتيح لخدمة ${model}`);
    this.model = model;
  }
}

export class ParamsRejection extends Error {
  arabicMessage: string;
  constructor(arabicMessage: string) {
    super(arabicMessage);
    this.arabicMessage = arabicMessage;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function keyRefOf(key: KeyRow): KeyRef {
  return { id: key.id, provider: key.provider, api_key: key.api_key, label: key.label };
}

function attemptEntry(key: KeyRow, ok: boolean, errorClass?: string, error?: string): AttemptEntry {
  return {
    provider: key.provider,
    keyId: key.id,
    keyLabel: key.label,
    ok,
    errorClass: errorClass as AttemptEntry["errorClass"],
    error,
    at: nowIso(),
  };
}

function normalizeError(err: unknown): { status: number | undefined; message: string } {
  if (err instanceof ProviderError) return { status: err.status, message: err.message };
  const msg = (err as Error)?.message ?? String(err);
  return { status: undefined, message: msg };
}

function parseParams(row: TaskRow): Record<string, unknown> {
  try {
    const v = JSON.parse(row.params_json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/* ---------- بناء معطيات كل مزود ---------- */

function buildProviderInput(
  def: ModelDef,
  params: Record<string, unknown>,
  provider: ProviderId,
): Record<string, unknown> {
  if (def.type === "image") {
    if (provider === "cometapi") {
      // محول CometAPI يبني جسم /v1/images/generations بنفسه من prompt/aspect_ratio
      return { prompt: params.prompt, aspect_ratio: params.aspect_ratio };
    }
    // kie Jobs API: input صريح — background يُطبَّق فقط على 1K (يتحقق منه المزود)
    const input: Record<string, unknown> = {
      prompt: params.prompt,
      aspect_ratio: params.aspect_ratio ?? "auto",
      resolution: params.resolution ?? "1K",
    };
    if (params.background) input.background = params.background;
    if (params.output_format) input.output_format = params.output_format;
    return input;
  }
  // فيديو
  if (provider === "cometapi") {
    // وفق توثيق grok/videos على CometAPI: image تُمرَّر داخل كائن image.url (يتولاه المحول)
    const input: Record<string, unknown> = { prompt: params.prompt };
    if (params.duration !== undefined) input.duration = params.duration;
    if (params.aspect_ratio !== undefined) input.aspect_ratio = params.aspect_ratio;
    if (params.resolution !== undefined) input.resolution = params.resolution;
    if (params.image_url) input.image_url = params.image_url;
    return input;
  }
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspect_ratio ?? "auto",
    resolution: params.resolution ?? "480p",
    enable_audio: params.enable_audio ?? true,
    duration: params.duration ?? 8,
  };
  if (params.image_url) input.image_url = params.image_url;
  return input;
}

/* ---------- التوليد (صورة / فيديو) ---------- */

export interface StartGenerationOptions {
  type: "image" | "video";
  prompt: string;
  params: Record<string, unknown>;
  waitSeconds: number;
  notify?: (message: string, progress: number, total: number) => void;
}

export async function startGeneration(opts: StartGenerationOptions): Promise<TaskRow> {
  const def = resolveModel(opts.params.model as string);
  if (!def || def.type !== opts.type) {
    throw new ParamsRejection(
      `❌ موديل غير معروف: ${String(opts.params.model ?? "")}. المتاح: gpt-image-2-6/flare-text-to-image (صور) و grok-imagine-video-1-5-preview (فيديو).`,
    );
  }
  const pool = await getKeyPool(def.providers);
  if (!pool.length) {
    throw new NoKeysError(def.canonical);
  }
  // سجّل المهمة في Turso قبل أي نداء خارجي — تبقى قابلة للتتبع حتى لو انقطع الاتصال
  const task = await insertTask({
    id: randomUUID(),
    model: def.canonical,
    type: opts.type,
    prompt: String(opts.prompt ?? ""),
    params: opts.params,
  });
  return driveGeneration(task, def, pool, effectiveWait(opts.waitSeconds), opts.notify, 0);
}

type Outcome =
  | { kind: "completed"; urls: string[] }
  | { kind: "failed"; error: string }
  | { kind: "expired" };

// حلقة التبديل التسلسلي: جرّب المرشحين بالترتيب حتى نجاح الإنشاء
async function driveGeneration(
  task: TaskRow,
  def: ModelDef,
  pool: KeyRow[],
  waitSeconds: number,
  notify?: StartGenerationOptions["notify"],
  startIndex = 0,
): Promise<TaskRow> {
  for (let i = startIndex; i < pool.length; i++) {
    const key = pool[i];
    const adapter = getAdapter(key.provider);
    const keyRef = keyRefOf(key);
    const model = def.providerModel[key.provider];
    const input = buildProviderInput(def, parseParams(task), key.provider);
    try {
      let providerTaskId: string | null = null;
      let syncUrls: string[] | null = null;

      if (def.type === "image" && adapter.createImageSync && key.provider === "cometapi") {
        // صور CometAPI متزامنة — نتيجة فورية (أو استقصاء داخلي قصير)
        notify?.("جارٍ التوليد لدى المزود… 90%", 90, 100);
        const out = await adapter.createImageSync(keyRef, model, input);
        syncUrls = out.urls;
      } else {
        const out = await adapter.createTask(keyRef, model, input);
        providerTaskId = out.providerTaskId;
      }

      // أول نجاح يربط المهمة بالمزود والمفتاح — والمحاولة تُسجَّل دائمًا
      await updateTask(task.id, {
        append_attempts: [attemptEntry(key, true)],
        provider: key.provider,
        key_id: key.id,
        ...(providerTaskId ? { provider_task_id: providerTaskId, progress: 5, status: "processing" as const } : {}),
      });
      await bumpKey(key.id, { ok: true });

      if (syncUrls) {
        return (await updateTask(task.id, {
          status: "completed",
          result_urls: syncUrls,
          progress: 100,
          expectStatus: "processing",
        }))!;
      }

      // نافذة الانتظار مع بث تقدم كل ~3 ثوانٍ
      const outcome = await pollProviderWindow(task.id, adapter, keyRef, providerTaskId!, waitSeconds, notify);
      if (outcome.kind === "completed") {
        return (await updateTask(task.id, {
          status: "completed",
          result_urls: outcome.urls,
          progress: 100,
          expectStatus: "processing",
        }))!;
      }
      if (outcome.kind === "failed") {
        if (isKeyOrBalanceError(outcome.error)) {
          // فشل منتصف المهمة بسبب مفتاح/رصيد → استئناف صامت على المفتاح التالي بنفس task_id
          const cls = classifyProviderError(undefined, outcome.error);
          await updateTask(task.id, {
            append_attempts: [attemptEntry(key, false, cls, outcome.error)],
            provider: null,
            provider_task_id: null,
            key_id: null,
            progress: 0,
            expectStatus: "processing",
          });
          await bumpKey(key.id, { ok: false, errorClass: cls, error: outcome.error });
          continue; // المفتاح التالي — العميل لا يرى شيئًا
        }
        // فشل حقيقي (انتهاك سياسة/معطيات) — لا فائدة من تبديل المفاتيح
        return (await updateTask(task.id, {
          status: "failed",
          error_message: `رفض المزود الطلب: ${outcome.error}`,
          expectStatus: "processing",
        }))!;
      }
      // انتهت النافذة والنتيجة لم تظهر → تبقى processing والعميل يتابع بـ get_task
      return (await getTask(task.id))!;
    } catch (err) {
      const { status, message } = normalizeError(err);
      const cls = classifyProviderError(status, message);
      await updateTask(task.id, { append_attempts: [attemptEntry(key, false, cls, message)] });
      await bumpKey(key.id, { ok: false, errorClass: cls, error: message });
      if (cls === "params") {
        // توقف فورًا — تبديل المفاتيح لن يحل خطأ معطيات
        return (await updateTask(task.id, {
          status: "failed",
          error_message: `معطيات الطلب مرفوضة من المزود: ${message}`,
          expectStatus: "processing",
        }))!;
      }
      // disabled / exhausted / provider / temporary → المفتاح التالي فورًا
      continue;
    }
  }
  // فشل الإنشاء على كل المفاتيح: تبقى processing (ليست failed) برسالة داخلية
  // «بانتظار توفر مفتاح صالح…» — تُعاد المحاولة تلقائيًا مع كل get_task بعد التهدئة،
  // وإن شُحن رصيد أي مفتاح تكتمل المهمة من تلقاء نفسها.
  return (await updateTask(task.id, {
    status: "processing",
    progress: 0,
    error_message: "بانتظار توفر مفتاح صالح…",
  }))!;
}

type ProviderOutcome =
  | { kind: "completed"; urls: string[] }
  | { kind: "failed"; error: string }
  | { kind: "expired" };

// استعلام كل 3 ثوانٍ حتى نهاية نافذة الانتظار مع بث التقدم
async function pollProviderWindow(
  taskId: string,
  adapter: ReturnType<typeof getAdapter>,
  keyRef: KeyRef,
  providerTaskId: string,
  waitSeconds: number,
  notify?: StartGenerationOptions["notify"],
): Promise<ProviderOutcome> {
  const deadline = Date.now() + waitSeconds * 1000;
  let lastProgress = 5;
  while (true) {
    try {
      const chk = await adapter.checkTask(keyRef, providerTaskId);
      if (chk.status === "completed" && chk.urls?.length) {
        return { kind: "completed", urls: chk.urls };
      }
      if (chk.status === "failed") {
        return { kind: "failed", error: chk.error ?? "فشل غير معروف" };
      }
      lastProgress = Math.max(lastProgress, Math.min(95, chk.progress ?? lastProgress + 3));
      await updateTask(taskId, { status: "processing", progress: lastProgress, expectStatus: "processing" });
      notify?.(`قيد التوليد… ${lastProgress}%`, lastProgress, 100);
    } catch (err) {
      const { status, message } = normalizeError(err);
      const cls = classifyProviderError(status, message);
      if (cls === "disabled" || cls === "exhausted") {
        // المفتاح مات في منتصف الاستعلام — يُعالج كفشل مفتاح في المستدعي
        return { kind: "failed", error: message };
      }
      // temporary (429/5xx/شبكة/timeout) → نستمر بالاستعلام حتى نهاية النافذة
    }
    if (Date.now() >= deadline) return { kind: "expired" };
    await sleep(POLL_INTERVAL_MS);
  }
}

/* ---------- تحديث حي عند get_task ---------- */

// قفل يمنع تزامن refresh متعددة على نفس المهمة داخل النسخة
export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  const row = await getTask(taskId);
  if (!row) return null;
  if (row.status === "completed" || row.status === "failed") return row;

  const inFlight = taskLocks.get(taskId);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      if (row.type === "merge") return await refreshMergeTask(row);
      return await refreshGenerationTask(row);
    } finally {
      taskLocks.delete(taskId);
    }
  })();
  taskLocks.set(taskId, p);
  return p;
}

async function refreshGenerationTask(row: TaskRow): Promise<TaskRow> {
  const def = resolveModel(row.model) ?? defaultModelOfType(row.type === "video" ? "video" : "image");
  const pool = await getKeyPool(def.providers);

  if (row.provider_task_id) {
    // مهمة جارية لدى المزود — تحديث حي بنفس منطق التبديل أعلاه
    const key = row.key_id ? await findKey(row.key_id) : null;
    if (key) {
      const adapter = getAdapter(key.provider);
      const keyRef = keyRefOf(key);
      try {
        const chk = await adapter.checkTask(keyRef, row.provider_task_id);
        if (chk.status === "completed" && chk.urls?.length) {
          return (await updateTask(row.id, {
            status: "completed",
            result_urls: chk.urls,
            progress: 100,
            expectStatus: "processing",
          }))!;
        }
        if (chk.status === "failed") {
          if (isKeyOrBalanceError(chk.error)) {
            // استئناف بنفس task_id على المفاتيح التالية
            const cls = classifyProviderError(undefined, chk.error ?? "");
            await updateTask(row.id, {
              append_attempts: [attemptEntry(key, false, cls, chk.error)],
              provider: null,
              provider_task_id: null,
              key_id: null,
              progress: 0,
              expectStatus: "processing",
            });
            await bumpKey(key.id, { ok: false, errorClass: cls, error: chk.error });
            const fresh = (await getTask(row.id))!;
            return await driveGeneration(fresh, def, pool, 10, undefined, nextIndexAfter(pool, key.id));
          }
          return (await updateTask(row.id, {
            status: "failed",
            error_message: `رفض المزود الطلب: ${chk.error}`,
            expectStatus: "processing",
          }))!;
        }
        // قيد المعالجة — نحدّث التقدم فقط
        const progress = Math.max(row.progress, Math.min(95, chk.progress ?? row.progress));
        return (await updateTask(row.id, { status: "processing", progress, expectStatus: "processing" }))!;
      } catch (err) {
        const { status, message } = normalizeError(err);
        const cls = classifyProviderError(status, message);
        if (cls === "disabled" || cls === "exhausted") {
          await updateTask(row.id, {
            append_attempts: [attemptEntry(key, false, cls, message)],
            provider: null,
            provider_task_id: null,
            key_id: null,
            progress: 0,
            expectStatus: "processing",
          });
          await bumpKey(key.id, { ok: false, errorClass: cls, error: message });
          const fresh = (await getTask(row.id))!;
          return await driveGeneration(fresh, def, pool, 10, undefined, nextIndexAfter(pool, key.id));
        }
        // مؤقت (شبكة مثلًا) — نعيد الحالة كما هي
        return row;
      }
    }
    // المفتاح اختفى (حُذف يدويًا) — نعيد الإنشاء على المفاتيح الحالية
    await updateTask(row.id, {
      provider: null,
      provider_task_id: null,
      key_id: null,
      progress: 0,
      expectStatus: "processing",
    });
    const fresh = (await getTask(row.id))!;
    return await driveGeneration(fresh, def, pool, 10, undefined, 0);
  }

  // بلا provider_task_id: إما تهدئة (~45 ثانية) أو إعادة محاولة الإنشاء على كل المفاتيح
  const attempts = attemptsOf(row);
  const last = Date.parse(row.updated_at || "") || 0;
  if (attempts.length && Date.now() - last < RETRY_COOLDOWN_MS) {
    return row; // تهدئة حتى لا نضغط المزودين
  }
  return await driveGeneration(row, def, pool, 10, undefined, 0);
}

function nextIndexAfter(pool: KeyRow[], keyId: string): number {
  const idx = pool.findIndex((k) => k.id === keyId);
  return idx < 0 ? 0 : idx + 1;
}

/* ---------- الدمج (خدمة Video Merger API v2) ---------- */

export interface MergeRequest {
  urls?: string[];
  task_ids?: string[];
  waitSeconds: number;
  notify?: (message: string, progress: number, total: number) => void;
}

// روابط عامة http/https مباشرة فقط
function isPublicHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const h = url.hostname.toLowerCase();
    if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === "0.0.0.0" || h === "::1") return false;
    return true;
  } catch {
    return false;
  }
}

export async function startMerge(req: MergeRequest): Promise<TaskRow> {
  if (!merger.mergerConfigured()) {
    throw new ParamsRejection("❌ خدمة الدمج غير مضبوطة على السيرفر — يجب ضبط متغير البيئة MERGER_API_BASE أولاً.");
  }

  // جمع الروابط: روابط task_ids المكتملة أولًا (بترتيبها) ثم urls المباشرة
  const failedDetails: string[] = [];
  const collected: string[] = [];
  for (const tid of req.task_ids ?? []) {
    const t = await getTask(String(tid));
    const urls = t ? resultUrlsOf(t) : [];
    if (!t) failedDetails.push(`• ${tid}: مهمة غير موجودة`);
    else if (t.status !== "completed") failedDetails.push(`• ${tid}: حالة المهمة «${t.status}» وليست completed`);
    else if (!urls.length) failedDetails.push(`• ${tid}: المهمة مكتملة بلا روابط نتيجة`);
    else collected.push(...urls);
  }
  for (const u of req.urls ?? []) collected.push(String(u));

  if (collected.length < 2) {
    let msg = "❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.";
    if (failedDetails.length) msg += `\n\nتفاصيل المعرّفات الفاشلة:\n${failedDetails.join("\n")}`;
    throw new ParamsRejection(msg);
  }
  if (collected.length > 10) {
    throw new ParamsRejection("❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى).");
  }
  const bad = collected.filter((u) => !isPublicHttpUrl(u));
  if (bad.length) {
    throw new ParamsRejection(
      "❌ روابط غير صالحة للدمج — يجب أن تكون http/https مباشرة وعامة (ليست محلية أو داخلية):\n" + bad.map((b) => `• ${b}`).join("\n"),
    );
  }

  // سجّل مهمة الدمج في Turso أولًا (provider=merger, model=video-merger)
  const task = await insertTask({
    id: randomUUID(),
    model: "video-merger",
    type: "merge",
    prompt: `دمج ${collected.length} مقاطع`,
    params: { urls: collected, processFired: false },
  });
  try {
    const job = await merger.createJob(collected);
    await updateTask(task.id, { provider: "merger", provider_task_id: job.jobId });
    fireProcess(task.id, job.jobId); // مرة واحدة فقط — خلفيًا وبقفل
    const outcome = await pollMergeWindow(task.id, job.jobId, effectiveWait(req.waitSeconds), req.notify);
    return (await applyMergeOutcome(task.id, outcome))!;
  } catch (err) {
    if (err instanceof merger.MergerError && err.final) {
      return (await updateTask(task.id, {
        status: "failed",
        error_message: `فشل الدمج: ${err.message}`,
        expectStatus: "processing",
      }))!;
    }
    // خطأ شبكتنا (مؤقت) — تبقى processing ويستأنفها get_task
    return (await getTask(task.id))!;
  }
}

// إطلاق POST .../process مرة واحدة فقط: قفل في الذاكرة + علم processFired في المعطيات
function fireProcess(taskId: string, jobId: string): void {
  if (processInFlight.has(jobId)) return;
  processInFlight.add(jobId);
  void (async () => {
    try {
      const t = await getTask(taskId);
      if (t) {
        const params = parseParams(t);
        if (params.processFired) return;
        params.processFired = true;
        await updateTask(taskId, { params });
      }
      await merger.processJob(jobId);
    } catch (err) {
      // الخطأ المعلن من الخدمة (مثل Download failed HTTP 403) حتمي — يُكتب مباشرة
      if (err instanceof merger.MergerError && err.final) {
        const t = await getTask(taskId);
        if (t && t.status === "processing" && !resultUrlsOf(t).length) {
          await updateTask(taskId, {
            status: "failed",
            error_message: `فشل الدمج: ${err.message}`,
            expectStatus: "processing",
          });
        }
      }
    } finally {
      processInFlight.delete(jobId);
    }
  })();
}

type MergeOutcome = { kind: "completed"; url: string } | { kind: "failed"; error: string } | { kind: "expired" };

async function pollMergeWindow(
  taskId: string,
  jobId: string,
  waitSeconds: number,
  notify?: (message: string, progress: number, total: number) => void,
): Promise<MergeOutcome> {
  const deadline = Date.now() + waitSeconds * 1000;
  let lastProgress = 5;
  while (true) {
    try {
      const st = await merger.getJobStatus(jobId);
      if (st.status === "done") {
        return { kind: "completed", url: merger.resultUrlOf(st, jobId) };
      }
      if (st.status === "failed") {
        return { kind: "failed", error: st.error ?? "دون تفاصيل" };
      }
      lastProgress = Math.max(lastProgress, Math.min(95, Math.round(st.progress)));
      await updateTask(taskId, { status: "processing", progress: lastProgress, expectStatus: "processing" });
      notify?.(`قيد الدمج… ${lastProgress}%`, lastProgress, 100);
    } catch (err) {
      if (err instanceof merger.MergerError) {
        if (err.notFound) {
          return { kind: "failed", error: "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)" };
        }
        if (err.final) return { kind: "failed", error: err.message };
        // مؤقت — نستمر بالاستعلام حتى انتهاء النافذة
      }
    }
    if (Date.now() >= deadline) return { kind: "expired" };
    await sleep(POLL_INTERVAL_MS);
  }
}

async function applyMergeOutcome(taskId: string, outcome: MergeOutcome): Promise<TaskRow | null> {
  if (outcome.kind === "completed") {
    return updateTask(taskId, {
      status: "completed",
      result_urls: [outcome.url],
      progress: 100,
      expectStatus: "processing",
    });
  }
  if (outcome.kind === "failed") {
    return updateTask(taskId, {
      status: "failed",
      error_message: `فشل الدمج: ${outcome.error}`,
      expectStatus: "processing",
    });
  }
  return getTask(taskId);
}

// get_task لمهمة دمج — تحديث من GET /api/jobs/{id} مع تنفيذ process عند اللزوم
async function refreshMergeTask(row: TaskRow): Promise<TaskRow> {
  if (!merger.mergerConfigured()) {
    // الخدمة غير مضبوطة بعد — تبقى بانتظار الضبط
    return row;
  }
  if (!row.provider_task_id) {
    // لم يُنشأ Job بعد (فشل شبكة عند الإنشاء) — إعادة محاولة بعد التهدئة
    const attempts = attemptsOf(row);
    const last = Date.parse(row.updated_at || "") || 0;
    if (attempts.length && Date.now() - last < RETRY_COOLDOWN_MS) return row;
    const urls = (parseParams(row).urls as string[] | undefined) ?? [];
    if (urls.length < 2) {
      return (await updateTask(row.id, {
        status: "failed",
        error_message: "معطيات الدمج مفقودة في قاعدة البيانات",
        expectStatus: "processing",
      }))!;
    }
    try {
      const job = await merger.createJob(urls);
      await updateTask(row.id, {
        provider: "merger",
        provider_task_id: job.jobId,
        append_attempts: [{ provider: "merger", keyId: "", keyLabel: "", ok: true, at: nowIso() }],
      });
      fireProcess(row.id, job.jobId);
      const outcome = await pollMergeWindow(row.id, job.jobId, 10, undefined);
      return (await applyMergeOutcome(row.id, outcome))!;
    } catch (err) {
      if (err instanceof merger.MergerError && err.final) {
        return (await updateTask(row.id, {
          status: "failed",
          error_message: `فشل الدمج: ${err.message}`,
          expectStatus: "processing",
        }))!;
      }
      return row;
    }
  }

  const jobId = row.provider_task_id;
  // إن لم يُنفَّذ process بعد — نفّذه الآن (القفل يمنع التكرار)
  const params = parseParams(row);
  if (!params.processFired) fireProcess(row.id, jobId);
  try {
    const st = await merger.getJobStatus(jobId);
    if (st.status === "done") {
      return (await updateTask(row.id, {
        status: "completed",
        result_urls: [merger.resultUrlOf(st, jobId)],
        progress: 100,
        expectStatus: "processing",
      }))!;
    }
    if (st.status === "failed") {
      return (await updateTask(row.id, {
        status: "failed",
        error_message: `فشل الدمج: ${st.error ?? "دون تفاصيل"}`,
        expectStatus: "processing",
      }))!;
    }
    const progress = Math.max(row.progress, Math.min(95, Math.round(st.progress)));
    return (await updateTask(row.id, { status: "processing", progress, expectStatus: "processing" }))!;
  } catch (err) {
    if (err instanceof merger.MergerError) {
      if (err.notFound) {
        return (await updateTask(row.id, {
          status: "failed",
          error_message: "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)",
          expectStatus: "processing",
        }))!;
      }
      if (err.final) {
        return (await updateTask(row.id, {
          status: "failed",
          error_message: `فشل الدمج: ${err.message}`,
          expectStatus: "processing",
        }))!;
      }
    }
    return row; // مؤقت — شبكتنا
  }
}

/* ---------- أداة list_media ---------- */

export async function listMedia(opts: { type?: string; status?: string; limit: number }): Promise<TaskRow[]> {
  return listRecentTasks(opts.limit, { type: opts.type, status: opts.status });
}
