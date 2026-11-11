# إعداد النشر على Vercel — خطوة بخطوة (بلا أي أسرار في هذا الملف)

هذا الدليل يحل التحذيرين اللذين تظهرهما لوحة الإدارة على Vercel:
**«قاعدة البيانات غير متصلة»** و **«خدمة الدمج: غير مضبوطة»** — السبب دائمًا: متغيرات البيئة غير مضبوطة على مشروع Vercel.

## 1) ربط قاعدة البيانات (Turso) — يحل التحذير الأول

1. افتح مشروعك على Vercel → **Settings** → **Environment Variables**.
2. أضف المتغيرين التاليين (القيم عندك في `.env.local` أو في محادثتك مع المساعد — **لا تضعها في أي ملف داخل هذا المستودع، فهو عام**):

| الاسم | القيمة |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://<اسم-قاعدتك>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | توكن Turso بصلاحيات كتابة (JWT يبدأ بـ `eyJ...`) |

3. اختر البيئات: Production + Preview + Development ثم **Save**.
4. أعد النشر: تبويب **Deployments** → أحدث نشر → ⋯ → **Redeploy**.
5. افتح لوحة الإدارة — يجب أن تختفي رسالة «قاعدة البيانات غير متصلة» ويظهر `/api/health` بقيمة `database: "turso-connected"`.

## 2) خدمة الدمج (Video Merger API v2) — يحل التحذير الثاني

التطبيق الرئيسي **لا ينزّل وسائط أبدًا** — الدمج يتم في خدمة خارجية منفصلة. خدمة حقيقية كاملة (ffmpeg) جاهزة في مجلد [`merger-service/`](./merger-service/) — بلا أي اعتماديات npm.

### أسرع طريق مجاني: Render

1. أنشئ **Web Service** جديدًا على [render.com](https://render.com) واربط نفس مستودع GitHub.
2. **Root Directory**: `merger-service` — الـ Runtime: **Docker** (يقرأ Dockerfile تلقائيًا).
3. أضف متغير بيئة: `MERGER_TOKEN` = كلمة سر من اختيارك (موصى به).
4. انشر — ستحصل على رابط مثل `https://video-merger-xxxx.onrender.com`.
5. عُد إلى Vercel وأضف على التطبيق الرئيسي:

| الاسم | القيمة |
| --- | --- |
| `MERGER_API_BASE` | رابط خدمة الدمج من Render |
| `MERGER_TOKEN` | نفس الكلمة السرية (إن ضبطتها هناك) |

6. Redeploy مرة أخيرة — اختفِ تحذير الدمج وأداة `merge_videos` تعمل فعليًا.

> بدائل: Railway / Fly.io / أي VPS — انظر `merger-service/README.md`.

## 3) فتح الوصول للعملاء (إلزامي!)

بشكل افتراضي Vercel يحمي النشر بـ «Vercel Authentication» — أي عميل MCP (ChatGPT / Claude / Cursor) **لن يصل إلى `/mcp`** إطلاقًا معها.

1. **Settings** → **Deployment Protection**.
2. أعطّل **Vercel Authentication** (و«Password Protection» إن كانت مفعّلة) للإنتاج.
3. احفظ — رابط `<origin>/mcp` في بطاقة «ربط السيرفر» يصبح صالحًا للجميع.

## 4) التحقق النهائي

```bash
curl https://<رابط-تطبيقك>/api/health
# المتوقع: {"ok":true,"database":"turso-connected","merger":{"healthy":true},...}

curl -X POST https://<رابط-تطبيقك>/mcp -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# المتوقع: استجابة initialize مع ترويسة mcp-session-id
```

## ملاحظة أمنية

- المستودع **عام** — لا تضع أبدًا توكن Turso أو مفاتيح kie.ai داخل أي ملف مُرفع إلى Git.
- مفاتيح التوليد تُدار من لوحة الإدارة بعد النشر (تُخزَّن في قاعدة بياناتك وتظهر مُقنَّعة فقط).
