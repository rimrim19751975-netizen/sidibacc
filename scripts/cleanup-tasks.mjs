// أداة تنظيف مهام قاعدة البيانات — أداء إداري (لا أسرار داخلها؛ تقرأ .env.local وقت التشغيل)
// الاستخدام:
//   node scripts/cleanup-tasks.mjs            # حذف كل المهام من جدول tasks
//   node scripts/cleanup-tasks.mjs --status failed   # حذف المهام الفاشلة فقط
//   node scripts/cleanup-tasks.mjs --id <uuid>       # حذف مهمة محددة
import { createClient } from "@libsql/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const k = t.slice(0, t.indexOf("=")).trim();
        const v = t.slice(t.indexOf("=") + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnv();

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("❌ TURSO_DATABASE_URL مطلوب (في .env.local)");
  process.exit(1);
}
// التوكن إلزامي مع Turso السحابية فقط — قاعدة file: محلية لا تحتاج توكنًا
const db = process.env.TURSO_AUTH_TOKEN
  ? createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url });

const arg = process.argv[2];
const val = process.argv[3];
let where = "";
const args = [];
if (arg === "--status" && val) {
  where = "WHERE status = ?";
  args.push(val);
} else if (arg === "--id" && val) {
  where = "WHERE id = ?";
  args.push(val);
}

const before = await db.execute("SELECT COUNT(*) AS c FROM tasks");
const rs = await db.execute(`DELETE FROM tasks ${where}`, args);
const after = await db.execute("SELECT COUNT(*) AS c FROM tasks");
console.log(`✅ حُذفت ${Number(before.rows[0].c) - Number(after.rows[0].c)} مهمة — المتبقي: ${Number(after.rows[0].c)}`);
