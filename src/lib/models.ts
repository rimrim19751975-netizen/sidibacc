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
// الصور: gpt-image-2.5-flare (نفس عائلة flare المدعومة رسميًا مع خلفية شفافة) — الفيديو: grok-imagine-video
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.5-flare";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video";

export const IMAGE_CANONICAL = "gpt-image-2-6/flare-text-to-image";
export const VIDEO_CANONICAL = "grok-imagine-video-1-5-preview";

export const MODELS: ModelDef[] = [
  {
    canonical: IMAGE_CANONICAL,
    aliases: [IMAGE_CANONICAL, "gpt-image-2.6/flare-text-to-image", "gpt-image-2.6-flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_IMAGE_MODEL, cometapi: COMETAPI_IMAGE_MODEL },
  },
  {
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
