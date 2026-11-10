// صياغة الردود العربية لأدوات MCP — نموذج الذكاء الاصطناعي لا يرى أخطاء مفاتيح/رصيد أبدًا
import { resultUrlsOf, type TaskRow } from "./turso";

function statusAr(row: TaskRow): string {
  if (row.status === "completed") return "✅ مكتملة";
  if (row.status === "failed") return "❌ فاشلة";
  return `⏳ جارية (${row.progress}%)`;
}

export function typeAr(type: string): string {
  if (type === "image") return "صورة";
  if (type === "video") return "فيديو";
  return "دمج";
}

function linksBlock(urls: string[]): string {
  if (urls.length === 1) return urls[0];
  return urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
}

// الصياغة المعيارية لكل حالة مهمة (المواصفة §8)
export function formatTaskForModel(row: TaskRow): string {
  const urls = resultUrlsOf(row);

  if (row.status === "completed" && urls.length) {
    if (row.type === "image") {
      const url = urls[0];
      return `✅ تم توليد الصورة بنجاح\n\n![image](${url})\n\nالرابط المباشر: ${url}`;
    }
    if (row.type === "video") {
      return `✅ تم توليد الفيديو بنجاح\n\nالروابط المباشرة:\n${linksBlock(urls)}`;
    }
    // دمج
    return `✅ تم دمج المقاطع بنجاح\n\nالروابط المباشرة:\n${linksBlock(urls)}\n\n⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.`;
  }

  if (row.status === "failed") {
    // error_message لمهام فاشلة لا يحتوي أبدًا تفاصيل مفاتيح/رصيد (مسار التبديل الصامت يمنع ذلك)
    return `❌ فشلت المهمة: ${row.error_message ?? "سبب غير معروف"}`;
  }

  // جارية — بلا أي تفاصيل داخلية (رسالة «بانتظار مفتاح» داخلية ولا تخرج للعميل)
  return `⏳ المهمة قيد المعالجة (${row.progress}%)\n\ntask_id: ${row.id}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.`;
}

export function formatNoKeys(model: string): string {
  return `❌ لا توجد مفاتيح نشطة لخدمة ${model}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`;
}

export function formatMediaList(rows: TaskRow[]): string {
  if (!rows.length) {
    return "لا توجد وسائط مخزنة بعد — ابدأ بأداة generate_image أو generate_video.";
  }
  const lines = rows.map((r, i) => {
    const urls = resultUrlsOf(r);
    let line = `${i + 1}. ${typeAr(r.type)} — ${r.model} — ${statusAr(r)} — ${r.created_at}`;
    if (urls.length) line += `\n   الرابط: ${linksBlock(urls)}`;
    else if (r.status === "processing") line += `\n   task_id: ${r.id} (تابع بـ get_task)`;
    else if (r.status === "failed" && r.error_message) line += `\n   السبب: ${r.error_message}`;
    return line;
  });
  return `📁 أحدث الوسائط المخزنة (${rows.length}):\n\n${lines.join("\n")}`;
}
