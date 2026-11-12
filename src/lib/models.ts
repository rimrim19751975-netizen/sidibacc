// سجل الموديلات: الاسم الموحد (canonical) كما يراه عميل MCP، مقابل اسم الموديل لدى كل مزود.
// الأسماء القانونية ثابتة، وأسماء المزودين قابلة للتجاوز بمتغيرات البيئة.
export type ProviderId = "kie" | "cometapi";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string; // الاسم كما يراه عميل MCP
  aliases: string[]; // صيغ بديلة نقبلها ونوحدّها (شرطات/نقاط)
  type: MediaType;
  providers: ProviderId[]; // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Record<ProviderId, string>; // اسم الموديل كما يُرسل لكل مزود
}

const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
// أسماء CometAPI من كتالوجها الحيّ (GET https://api.cometapi.com/api/models) — مُتحقَّق منه فعليًا 2026-11:
// الصور: gpt-image-2.5-flare (نفس عائلة flare المدعومة رسميًا مع خلفية شفافة)
// فيديو الاسم القديم (grok-imagine-video): بطيء ومكلف (＄0.105/ث) — نوجّه الاسم القديم نفسه
// إلى doubao-seedance-2-0-mini الاقتصادي (＄0.032/ث → فيديو 5 ثوانٍ ≈ ＄0.16) حتى تكتمل
// المهام العالقة بالأرصدة المجانية الصغيرة، ويبقى grok متاحًا عبر kie عند إضافة مفتاح له
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.5-flare";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "doubao-seedance-2-0-mini";
// الفيديو السريع: عائلة Seedance عبر POST /v1/videos — الأسرع لدى CometAPI
const COMETAPI_SEEDANCE_MODEL = process.env.COMETAPI_SEEDANCE_MODEL || "doubao-seedance-2-0-fast";
// الفيديو الاقتصادي: doubao-seedance-2-0-mini — الأرخص في العائلة (480p ≈ $0.032/ث → فيديو 5 ثوانٍ ≈ $0.16)
const COMETAPI_SEEDANCE_MINI_MODEL = process.env.COMETAPI_SEEDANCE_MINI_MODEL || "doubao-seedance-2-0-mini";

export const IMAGE_CANONICAL = "gpt-image-2-6/flare-text-to-image";
export const VIDEO_CANONICAL = "grok-imagine-video-1-5-preview";
export const SEEDANCE_FAST_CANONICAL = "doubao-seedance-2-0-fast";
export const SEEDANCE_MINI_CANONICAL = "doubao-seedance-2-0-mini";

export const MODELS: ModelDef[] = [
  {
    // الفيديو الافتراضي: Seedance 2.0 Fast — الأسرع لدى CometAPI (ثوانٍ قليلة بدل دقائق لدى Grok)
    // متاح عبر CometAPI فقط حاليًا — providerModel.kie فارغ عمدًا ولن يُستدعى أبدًا (ليس في providers)
    canonical: SEEDANCE_FAST_CANONICAL,
    aliases: [SEEDANCE_FAST_CANONICAL, "seedance-2-0-fast", "seedance-fast"],
    type: "video",
    providers: ["cometapi"],
    providerModel: { kie: "", cometapi: COMETAPI_SEEDANCE_MODEL },
  },
  {
    // الفيديو الاقتصادي: Seedance 2.0 Mini — نفس العائلة ونفس نقطة النهاية /v1/videos، بسعر أقل
    canonical: SEEDANCE_MINI_CANONICAL,
    aliases: [SEEDANCE_MINI_CANONICAL, "seedance-2-0-mini", "seedance-mini"],
    type: "video",
    providers: ["cometapi"],
    providerModel: { kie: "", cometapi: COMETAPI_SEEDANCE_MINI_MODEL },
  },
  {
    canonical: IMAGE_CANONICAL,
    aliases: [IMAGE_CANONICAL, "gpt-image-2.6/flare-text-to-image", "gpt-image-2.6-flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_IMAGE_MODEL, cometapi: COMETAPI_IMAGE_MODEL },
  },
  {
    // بديل الفيديو الأصلي (أبطأ لكن مدعوم لدى kie وCometAPI معًا) — يبقى متاحًا بالاسم القديم
    canonical: VIDEO_CANONICAL,
    aliases: [VIDEO_CANONICAL, "grok-imagine-video-1.5-preview"],
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_VIDEO_MODEL, cometapi: COMETAPI_VIDEO_MODEL },
  },
];

// توحيد الصيغ البديلة (شرطات/نقاط) إلى التعريف الرسمي — غير معروف ← null (خطأ معطيات)
export function resolveModel(name?: string | null): ModelDef | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return MODELS.find((m) => m.aliases.some((a) => a.toLowerCase() === n)) ?? null;
}

export function defaultModelOfType(type: "image" | "video"): ModelDef {
  return MODELS.find((m) => m.type === type)!;
}
