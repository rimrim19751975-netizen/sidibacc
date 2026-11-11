# MCP Media Generator — خادم توليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع

خادم **MCP** (Model Context Protocol) يعرض 5 أدوات لأي عميل (ChatGPT Connectors / Claude Desktop / Cursor / Windsurf / Cline / GPT Agents SDK) لتوليد الصور والفيديو ودمج المقاطع، مع **لوحة إدارة عربية RTL** لإدارة مفاتيح API ومتابعة المهام حيًا.

## القدرات الثلاث

| القدرة | الموديل المدمج | المزودون |
| --- | --- | --- |
| توليد صور من وصف نصي | `gpt-image-2-6/flare-text-to-image` | kie.ai + CometAPI |
| توليد فيديو بصوت متزامن أصلي | `grok-imagine-video-1-5-preview` | kie.ai + CometAPI |
| دمج عدة مقاطع في مقطع واحد | `video-merger` (خدمة دمج خارجية) | Video Merger API v2 |

## الأدوات الخمس على /mcp

1. **generate_image** — توليد صورة؛ تعيد الرابط جاهزًا إن اكتملت خلال نافذة الانتظار وإلا `task_id`.
2. **generate_video** — توليد فيديو (image-to-video اختياري)؛ تعيد `task_id` فورًا مع بث تقدم حي.
3. **merge_videos** — دمج 2–10 مقاطع عبر `urls` مباشرة أو `task_ids` لمهام مكتملة (تُحل بالترتيب).
4. **get_task** — متابعة أي مهمة بمعرّفها (تحديث حي من المزود/خدمة الدمج).
5. **list_media** — أحدث الوسائط المخزنة بروابطها من قاعدة البيانات.

## القواعد الجوهرية (لا تُخترق)

- **روابط فقط**: لا يُنزَّل أي ملف وسائط على السيرفر إطلاقًا — تُخزَّن روابط النتائج في قاعدة البيانات فقط.
- **ترتيب تسلسلي صارم للمفاتيح**: أول مفتاح أُضيف يُجرَّب أولًا (`created_at ASC, id ASC`) — ليس round-robin.
- **لا توقف عند نفاد الرصيد**: تبديل فوري تلقائي للمفتاح التالي واستئناف **نفس المهمة بنفس task_id**.
- **العميل لا يرى أخطاء المفاتيح/الرصيد أبدًا** — التبديل صامت تمامًا من وجهة نظره.
- **مهمة فشلت على كل المفاتيح تبقى `processing`** («بانتظار توفر مفتاح صالح…») وتُعاد محاولتها تلقائيًا مع كل `get_task` بعد تهدئة ~45 ثانية — لو شُحن رصيد أي مفتاح تكتمل من تلقاء نفسها.
- **أخطاء خدمة الدمج المعلنة (4xx/5xx) حتمية فورية**؛ أخطاء شبكتنا مؤقتة وتستمر بالاستعلام.
- **ملفات الدمج تُحذف بعد ~24 ساعة** — تنبيه مضمّن في وصف الأداة وتعليمات الخادم.
- **إخفاء المفاتيح إلزامي**: أول 7 أحرف + `•••••••` + آخر 4، ولا يُعاد المفتاح الكامل في أي استجابة.

## التقنيات

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- `@modelcontextprotocol/sdk` — `McpServer` + النقل الرسمي Streamable HTTP (بلا JSON-RPC يدوي)
- `@libsql/client` مع قاعدة **Turso** عبر HTTP — متوافق تمامًا مع Vercel serverless (بلا ملفات محلية)
- كل مسارات API بـ `runtime = "nodejs"`، و`/mcp` و`/api/health` بـ `dynamic = "force-dynamic"`

## قاعدة البيانات (مخطط مبسّط)

- `tasks` — كل مهمة: المزود، معرّف المزود، المفتاح المستخدم، الموديل، الحالة، التقدم، روابط النتائج، وسجل المحاولات `attempts_json`.
- `api_keys` — المفاتيح مع العدادات (استخدام/نجاح/فشل) والحالة (`active | exhausted | disabled`).
- تُنشأ الجداول تلقائيًا عند أول وصول (`CREATE TABLE IF NOT EXISTS`) — بلا أداة migrations.

## التشغيل محليًا

```bash
bun install   # أو npm install

# أنشئ .env.local (انظر .env.example)
cp .env.example .env.local

bun run dev   # http://localhost:3000
```

### متغيرات البيئة

| المتغير | إلزامي | الوصف |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | ✅ | `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | ✅ | توكن Turso بصلاحيات كتابة |
| `MERGER_API_BASE` | ✅ للدمج | رابط خدمة Video Merger API v2 |
| `MERGER_TOKEN` | — | كلمة سر خدمة الدمج (إن ضُبطت على الخدمة يُرسل تلقائيًا كـ Bearer) |
| `MCP_ACCESS_TOKEN` | — | إن ضُبط يُطلب `Authorization: Bearer <token>` على /mcp |
| `KIE_IMAGE_MODEL` / `KIE_VIDEO_MODEL` / `COMETAPI_IMAGE_MODEL` / `COMETAPI_VIDEO_MODEL` | — | تجاوز أسماء الموديلات |

> **خدمة الدمج الحقيقية مضمّنة في المستودع** — مجلد `merger-service/`: خدمة مستقلة بلا اعتماديات npm (Node خام + ffmpeg) تُنفِّذ المواصفة §7 كاملة (H.264+AAC حتى 1080p، حدود 10 مقاطع/200MB/150MB/600 ثانية، حذف تلقائي بعد 24 ساعة). انظر `merger-service/README.md` للنشر المجاني على Render/Railway/VPS.
> ولباختبار سريع بلا ffmpeg: `node scripts/mock-merger.mjs` محاكي على المنفذ 8787.

### إنشاء قاعدة Turso مجانية

```bash
turso db create <name>
turso db show <name> --url          # ← TURSO_DATABASE_URL
turso db tokens create <name>       # ← TURSO_AUTH_TOKEN
```

## النشر على Vercel

1. اربط المستودع في Vercel → New Project.
2. أضف متغيرات البيئة في Settings → Environment Variables: `TURSO_DATABASE_URL` و `TURSO_AUTH_TOKEN` إلزاميان، و `MERGER_API_BASE` (رابط خدمة الدمج من `merger-service/`) و `MERGER_TOKEN` إن فعّلت الحماية.
3. **مهم — أوقف حماية النشر**: Settings → Deployment Protection → أعطّل «Vercel Authentication»، وإلا فلن يستطيع أي عميل MCP الوصول إلى `/mcp` وستظهر لوحة الإدارة متحطة بالوصول العام.
4. Deploy — كل شيء يعمل عبر HTTP (libSQL) و streaming (/mcp) بلا أي ملف محلي.
5. بعد النشر: افتح لوحة الإدارة ← أضف مفاتيحك ← انسخ رابط `<origin>/mcp` من بطاقة «ربط السيرفر» إلى عميلك.

## الربط من العملاء

```jsonc
// ChatGPT / GPT Agents / Cursor / Windsurf / Cline
{ "mcpServers": { "media-generator": { "url": "https://<origin>/mcp" } } }

// Claude Desktop (claude_desktop_config.json)
{ "mcpServers": { "media-generator": { "type": "http", "url": "https://<origin>/mcp" } } }
```

اللوحة تعرض هذه الإعدادات جاهزة للنسخ لكل عميل، مع ترويسة Authorization تلقائيًا عند تفعيل التوكن.

## سكربتات مساعدة

| السكربت | الوظيفة |
| --- | --- |
| `scripts/mock-merger.mjs` | محاكي خدمة الدمج (نفس نقاط النهاية الحقيقية) للاختبار المحلي |
| `scripts/cleanup-tasks.mjs` | تنظيف مهام قاعدة البيانات (`--all` افتراضي، أو `--status failed`، أو `--id <uuid>`) |

## الأمان

- `.env*` مستثنى من Git منذ اليوم الأول — لا أسرار في الكود إطلاقًا.
- المفاتيح تُخزَّن في قاعدة بياناتك وتظهر **مُقنَّعة** فقط في كل الاستجابات والسجلات.
- نقاط MCP اختيارية الحماية بـ Bearer token عبر `MCP_ACCESS_TOKEN`.
