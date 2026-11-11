"use client";

// لوحة التشخيص الذاتي — تشرح بالضبط ما الذي ناقص بعد النشر وكيف تُكمل الإعداد
// بلا أي أسرار: أسماء المتغيرات فقط، والقيم تبقى عند المستخدم في .env.local / لوحة المنصة
import { AlertTriangle, BookOpen, DatabaseZap, ServerCog } from "lucide-react";
import { CopyButton } from "./bits";
import type { HealthDto } from "./bits";

const GUIDE_URL = "https://github.com/rimrim19751975-netizen/sidibacc/blob/main/VERCEL-SETUP.md";

export function SetupPanel({ health }: { health: HealthDto | null }) {
  if (!health) return null;
  const dbMissing = health.database === "env-missing";
  const dbError = health.database === "error";
  const mergerUnset = health.merger.configured === false;
  if (!dbMissing && !dbError && !mergerUnset) return null;

  const onVercel = health.platform === "vercel";

  return (
    <div className="space-y-3" role="alert">
      {/* حالة 1: متغيرات قاعدة البيانات غير مضبوطة على المنصة (أكثر الحالات شيوعًا بعد النشر) */}
      {dbMissing && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="size-4" />
            خطوة أخيرة مطلوبة: متغيرات قاعدة البيانات غير مضبوطة على منصة الاستضافة
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            التطبيق منشور ويعمل، لكنه لا يصل إلى قاعدة Turso لأن متغيرات الاتصال لم تُضبط بعد في إعدادات المشروع على المنصة
            {onVercel ? " (Vercel)" : ""}. أسماء المتغيرات المطلوبة — القيم نفسها الموجودة لديك محليًا في
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">.env.local</code>
            (لا تضع القيم في المستودع فهو عام):
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2" dir="ltr">
            {(health.missingEnv?.length ? health.missingEnv : ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]).map((name) => (
              <span key={name} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2 py-1 font-mono text-xs text-slate-800">
                <code>{name}</code>
                <CopyButton text={name} label="نسخ الاسم" />
              </span>
            ))}
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-xs leading-relaxed text-amber-900">
            {onVercel ? (
              <>
                <li>
                  افتح مشروعك على <span className="font-semibold" dir="ltr">vercel.com</span> →
                  <span className="font-semibold" dir="ltr"> Settings → Environment Variables</span>
                </li>
                <li>أضف المتغيرين أعلاه بالقيم نفسها من <span dir="ltr">.env.local</span>، واختر البيئات Production + Preview + Development ثم Save</li>
                <li>
                  تبويب <span dir="ltr">Deployments</span> → أحدث نشر → ⋯ →
                  <span className="font-semibold" dir="ltr"> Redeploy</span>
                </li>
                <li>حدّث هذه الصفحة — ستتحول البطاقة العلوية إلى «Turso متصل» تلقائيًا</li>
              </>
            ) : (
              <>
                <li>افتح إعدادات مشروعك على منصة الاستضافة → قسم متغيرات البيئة (Environment Variables)</li>
                <li>أضف المتغيرين أعلاه بالقيم نفسها من <span dir="ltr">.env.local</span> ثم احفظ</li>
                <li>أعد نشر التطبيق (Redeploy / Restart) ثم حدّث هذه الصفحة</li>
              </>
            )}
          </ol>
          <a
            href={GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 underline decoration-amber-400 underline-offset-4"
          >
            <BookOpen className="size-3.5" />
            الدليل الكامل خطوة بخطوة: VERCEL-SETUP.md
          </a>
        </div>
      )}

      {/* حالة 2: المتغيرات مضبوطة لكن الاتصال فشل فعليًا */}
      {dbError && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-red-900">
            <DatabaseZap className="size-4" />
            تعذر الاتصال بقاعدة البيانات رغم أن المتغيرات مضبوطة
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-red-800">
            تحقق من صحة <code className="rounded bg-red-100 px-1 py-0.5 font-mono" dir="ltr">TURSO_DATABASE_URL</code> و
            <code className="mx-1 rounded bg-red-100 px-1 py-0.5 font-mono" dir="ltr">TURSO_AUTH_TOKEN</code>
            في إعدادات المنصة — أشهر الأسباب: توكن منتهي الصلاحية (أنشئ توكنًا جديدًا من لوحة Turso) أو رابط قاعدة غير صحيح.
            قد يكون أيضًا انقطاعًا مؤقتًا من Turso نفسه — أعد المحاولة بعد دقيقة.
          </p>
        </div>
      )}

      {/* حالة 3: خدمة الدمج غير مضبوطة (مستقلة عن قاعدة البيانات) */}
      {mergerUnset && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <ServerCog className="size-4" />
            خدمة الدمج غير مضبوطة — الخطوات لتفعيلها
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            الدمج يجري في خدمة خارجية منفصلة (التطبيق الرئيسي لا ينزّل وسائط أبدًا). خدمة حقيقية كاملة جاهزة في مجلد
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">merger-service/</code>
            بالمستودع — انشرها مجانًا على Render (Runtime: Docker، Root Directory:
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">merger-service</code>)،
            ثم أضف على هذه المنصة المتغير
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">MERGER_API_BASE</code>
            برابط الخدمة، و
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">MERGER_TOKEN</code>
            (اختياري — نفس الكلمة السرية إن ضبطتها هناك)، ثم Redeploy. حتى ذلك الحين تعمل بقية الأدوات طبيعيًا، وأداة
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono" dir="ltr">merge_videos</code>
            تعيد رسالة واضحة بدل الانهيار.
          </p>
        </div>
      )}
    </div>
  );
}
