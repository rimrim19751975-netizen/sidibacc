// مزود مجاني بالكامل للصور — Pollinations.ai (بلا مفتاح API وبلا رصيد)
// GET https://image.pollinations.ai/prompt/{prompt}?width&height&seed&model=flux&nologo=true
// يعيد الصورة مباشرة من نفس الرابط → الرابط نفسه هو الناتج النهائي (مبدأ «روابط فقط» محفوظ:
// نتحقق من الرأس فقط ثم نلغي جسم الاستجابة — لا تنزيل وسائط).
import { ProviderError } from "./types";

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const FREE_IMAGE_TIMEOUT = 90_000;

// نسب الأبعاد → مقاسات شائعة يدعمها flux (نحو 1K)
const ASPECT_SIZES: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
  "5:4": [1120, 896],
  "4:5": [896, 1120],
  "2:1": [1280, 640],
  "1:2": [640, 1280],
  "21:9": [1344, 576],
  "9:21": [576, 1344],
  "3:1": [1536, 512],
  "1:3": [512, 1536],
};

// توليد صورة مجانية — يعيد رابطًا عامًا مستقرًا (نفس البذرة = نفس الصورة)
export async function pollinationsImage(input: Record<string, unknown>): Promise<{ urls: string[] }> {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new ProviderError(400, "وصف الصورة مطلوب");
  const aspect = typeof input.aspect_ratio === "string" && ASPECT_SIZES[input.aspect_ratio] ? input.aspect_ratio : "1:1";
  const [width, height] = ASPECT_SIZES[aspect];
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FREE_IMAGE_TIMEOUT) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(504, `تعذر الوصول لخدمة الصور المجانية: ${msg.slice(0, 120)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.startsWith("image/")) {
    await res.body?.cancel().catch(() => {});
    throw new ProviderError(502, `فشلت خدمة الصور المجانية (HTTP ${res.status})`);
  }
  await res.body?.cancel().catch(() => {}); // الرؤوس كافية — نلغي الجسم فورًا
  return { urls: [url] };
}
