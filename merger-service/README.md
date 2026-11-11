# خدمة دمج الفيديو — Video Merger API v2 (ffmpeg)

خدمة مستقلة **بلا أي اعتماديات npm**: Node.js الخام + `ffmpeg` المثبت على النظام. تُنفِّذ بدقة المواصفة §7 التي يستهلكها التطبيق الرئيسي (`MERGER_API_BASE`).

## لماذا هذه الخدمة؟

التطبيق الرئيسي (MCP Media Generator) **لا ينزّل أي وسائط أبدًا** (القاعدة الذهبية 1) — الدمج يتطلب تنزيل المقاطع وترميزها، لذلك يعيش في **خدمة خارجية منفصلة** تمامًا. هذه هي تلك الخدمة.

## التشغيل

### محليًا (يتطلب ffmpeg)

```bash
node server.mjs                    # المنفذ الافتراضي 8787
PORT=9000 node server.mjs          # منفذ آخر
MERGER_TOKEN=سري node server.mjs   # حماية اختيارية بـ Bearer token
```

### عبر Docker

```bash
docker build -t video-merger .
docker run -p 8787:8787 -v merger-data:/app/data video-merger
```

### النشر المجاني على Render (الأسهل)

1. أنشئ مستودعًا/خدمة **Web Service** جديدة على [render.com](https://render.com) → **Deploy an existing image** أو اربط هذا المستودع.
2. الإعدادات:
   - **Runtime**: Docker (يقرأ `Dockerfile` تلقائيًا)
   - **Environment Variable**: `MERGER_TOKEN` = كلمة سر من اختيارك (يوصى به — الخدمة العامة بلا حماية افتراضيًا)
3. بعد النشر تحصل على رابط مثل `https://video-merger-xxxx.onrender.com`.
4. ضع في إعدادات التطبيق الرئيسي على Vercel:
   - `MERGER_API_BASE` = رابط الخدمة أعلاه
   - `MERGER_TOKEN` = نفس الكلمة السرية (إن ضبطتها)

> مجاني على Render مع تعطيل الخدمة عند الخمول (أول طلب يستغرق ~30 ثانية للاستيقاظ) — مقبول تمامًا للاستخدام الشخصي.

### بدائل: Railway / Fly.io / VPS

أي بيئة تشغّل Docker أو لديها ffmpeg تكفي:

```bash
# VPS مباشرة
apt install -y ffmpeg nodejs
node server.mjs &   # مع pm2 يُفضَّل: pm2 start server.mjs
```

## نقاط النهاية (مطابقة للمواصفة §7)

| النقطة | الوصف |
| --- | --- |
| `GET /api/config` | الحدود: 10 مقاطع، 200MB/مصدر، 150MB/ناتج، 600 ثانية، احتفاظ 24 ساعة |
| `POST /api/jobs` | `{"videos":["رابط1","رابط2",...]}` → `{jobId,status,statusUrl,processUrl,expiresAt}` |
| `POST /api/jobs/{id}/process` | **حاجب**: تنزيل + دمج → `{status:"done",videoUrl,downloadUrl,size,duration,resolution,expiresAt}` أو HTTP 500 `{"error"}` |
| `GET /api/jobs/{id}` | `{status,progress(0..100),videoUrl?,downloadUrl?,error?}` |
| `GET /api/jobs/{id}/video` | الملف المدموج MP4 (`?download=1` للتنزيل) |
| `DELETE /api/jobs/{id}` | حذف فوري |

## سلوك الدمج

- تنزيل تسلسلي للمقاطع مع حد 200MB صارم لكل مصدر ومهلة 120 ثانية.
- تحقق `ffprobe` من المدد — يُرفض أي مجموع يتجاوز 600 ثانية.
- إعادة ترميز موحّدة: H.264 (CRF 18، maxrate 2M) + AAC 128k، 30fps، مقاس أول مقطع حتى 1080p (scale+pad للأبعاد الزوجية) — يتسامح مع اختلاف المقاسات/الترميزات/غياب الصوت (صمت تلقائي).
- المخرج ≤ 150MB مضمون، مع `+faststart` للتشغيل الفوري من المتصفح.
- حذف تلقائي بعد 24 ساعة (تنظيف دوري كل 10 دقائق) + حذف المصادر فور انتهاء الدمج.
- روابط الفيديو الناتجة تُبنى من ترويسة `Host`/`X-Forwarded-*` فتعمل خلف البروكسي تلقائيًا.

## اختبار سريع

```bash
curl http://localhost:8787/api/config
curl -X POST http://localhost:8787/api/jobs -H "Content-Type: application/json" \
  -d '{"videos":["https://رابط-فيديو1.mp4","https://رابط-فيديو2.mp4"]}'
curl -X POST http://localhost:8787/api/jobs/<jobId>/process   # حاجب ~10-15 ثانية
curl http://localhost:8787/api/jobs/<jobId>
```
