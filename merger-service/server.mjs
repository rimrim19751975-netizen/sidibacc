// خدمة دمج الفيديو الحقيقية — Video Merger API v2 (المواصفة §7)
// صفر اعتماديات: Node.js الخام + ffmpeg/ffprobe المثبتان على النظام.
//
// النقاط المُنفَّذة بدقة وفق المواصفة:
//   GET    /api/config            → الحدود والاحتفاظ
//   POST   /api/jobs              → إنشاء مهمة دمج من روابط مباشرة {"videos":[...]} → {jobId,status,statusUrl,processUrl,expiresAt}
//   POST   /api/jobs/{id}/process → استدعاء حاجب (10–15 ثانية عادة): تنزيل + دمج → {status:"done",videoUrl,downloadUrl,size,duration,resolution,expiresAt} أو HTTP 500 {"error"}
//   GET    /api/jobs/{id}         → {status,progress(0..100),videoUrl?,downloadUrl?,error?}
//   GET    /api/jobs/{id}/video   → الملف المدموج (?download=1 للتنزيل)
//   DELETE /api/jobs/{id}         → حذف فوري
//
// الحدود: 10 مقاطع كحد أقصى، 200MB لكل مصدر، 150MB للناتج، 600 ثانية مجموع المدد، حذف تلقائي بعد 24 ساعة.
// المخرجات: MP4 (H.264 + AAC) حتى 1080p بجودة CRF 18 مع إعادة ترميز موحّد (يتسامح مع اختلاف المقاسات/الترميزات).
//
// التشغيل:  PORT=8787 node server.mjs   (أو عبر Dockerfile المرفق)
// أمان اختياري: إن ضُبط MERGER_TOKEN يُطلب "Authorization: Bearer <MERGER_TOKEN>" على كل نقاط /api.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/* ---------- التهيئة ---------- */

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.MERGER_DATA_DIR || path.join(process.cwd(), "data");
const MERGER_TOKEN = (process.env.MERGER_TOKEN || "").trim();

const LIMITS = {
  maxClips: 10,
  maxSourceBytes: 200 * 1024 * 1024, // 200MB لكل مصدر
  maxOutputBytes: 150 * 1024 * 1024, // 150MB للناتج
  maxTotalDurationSec: 600, // 10 دقائق مجموعًا
};
const RETENTION_HOURS = 24;
const DOWNLOAD_TIMEOUT_MS = 120_000; // مهلة تنزيل كل مصدر
const PROCESS_TIMEOUT_MS = 12 * 60_000; // مهلة قصوى لعملية الدمج كاملة

await fsp.mkdir(DATA_DIR, { recursive: true });

/* ---------- حالة المهام ---------- */

/** @type {Map<string, any>} */
const jobs = new Map();

function jobId() {
  return `mrg-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function baseUrl(req) {
  // نستخدم ترويسات البروكسي إن وُجدت لتصحيح الروابط خلف Render/Railway/nginx
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`);
  const proto = String(req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http"));
  return `${proto}://${host}`;
}

function urlsFor(job, req) {
  const b = baseUrl(req);
  return {
    statusUrl: `${b}/api/jobs/${job.id}`,
    processUrl: `${b}/api/jobs/${job.id}/process`,
    videoUrl: `${b}/api/jobs/${job.id}/video`,
    downloadUrl: `${b}/api/jobs/${job.id}/video?download=1`,
  };
}

function publicJob(job, req) {
  const u = urlsFor(job, req);
  const out = {
    jobId: job.id,
    status: job.state, // queued | processing | done | failed
    progress: Math.max(0, Math.min(100, Math.round(job.progress || 0))),
    expiresAt: new Date(job.expiresAt).toISOString(),
    ...u,
  };
  if (job.state === "done") {
    out.videoUrl = u.videoUrl;
    out.downloadUrl = u.downloadUrl;
    out.size = job.size;
    out.duration = job.duration;
    out.resolution = job.resolution;
  }
  if (job.state === "failed" && job.error) out.error = job.error;
  return out;
}

function fail(job, message) {
  job.state = "failed";
  job.error = String(message).slice(0, 500);
  job.progress = 0;
}

/* ---------- أدوات ---------- */

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(data);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

async function ffprobe(file) {
  const { code, stdout, stderr } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    file,
  ], 30_000);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr.slice(0, 200)}`);
  const info = JSON.parse(stdout);
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  const a = (info.streams || []).find((s) => s.codec_type === "audio");
  const dur = Number(info.format?.duration || v?.duration || 0);
  if (!v) throw new Error("No video stream found");
  return {
    duration: dur,
    width: v.width || 0,
    height: v.height || 0,
    hasAudio: !!a,
  };
}

// تنزيل مصدر إلى ملف مع حد حجم صارم ومهلة — روابط فقط تمر عبر هنا، لا معالجة وسيطة
// نستخدم pipeline(Readable.fromWeb) — يدير الضغط الخلفي بشكل صحيح (يدوي getReader يُفسد undici)
async function downloadTo(url, file, maxBytes, onProgress) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Source HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) throw new Error(`Source too large (${Math.round(len / 1048576)}MB > 200MB limit)`);
    const out = fs.createWriteStream(file);
    let received = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          received += chunk.length;
          if (received > maxBytes) throw new Error(`Source too large (>200MB while downloading)`);
          if (onProgress && len) onProgress(Math.round((received / len) * 100));
          yield Buffer.from(chunk);
        }
      },
      out,
    );
    return received;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- منطق الدمج (حاجب) ---------- */

async function processJob(job, req) {
  const dir = path.join(DATA_DIR, job.id);
  let files = [];
  const t0 = Date.now();
  try {
    job.state = "processing";
    job.progress = 2;
    await fsp.mkdir(dir, { recursive: true });

    // 1) التنزيل المتسلسل مع الحدود (5% → 45%)
    for (let i = 0; i < job.videos.length; i++) {
      const f = path.join(dir, `src-${i}.mp4`);
      await downloadTo(job.videos[i], f, LIMITS.maxSourceBytes);
      files.push(f);
      job.progress = 5 + Math.round(((i + 1) / job.videos.length) * 40);
    }

    // 2) التحقق من المدد والمقاسات (48%)
    job.progress = 48;
    const infos = [];
    let total = 0;
    for (const f of files) {
      const info = await ffprobe(f);
      total += info.duration;
      if (total > LIMITS.maxTotalDurationSec) {
        throw new Error(`Total duration exceeds ${LIMITS.maxTotalDurationSec}s limit`);
      }
      infos.push(info);
    }

    // 3) اختيار مقاس الهدف: مقاس أول مقطع موحّد الأبعاد حتى 1080p (أبعاد زوجية إلزامية لـ H.264)
    const first = infos[0];
    let targetW = Math.min(first.width || 1280, 1920);
    let targetH = Math.min(first.height || 720, 1080);
    if (!targetW || !targetH) [targetW, targetH] = [1280, 720];
    if (targetW % 2) targetW--;
    if (targetH % 2) targetH--;

    // 4) بناء مرشّحات الدمج — من يدخل بلا صوت نولّد له صمتًا ليكتمل المسار دائمًا
    //    مهم: مؤشرات المدخلات تتقدم مع كل مدخل lavfi مُدرج — نحسبها بعدّاد واحد
    const args = [];
    const parts = [];
    let nextIdx = 0;
    for (let i = 0; i < files.length; i++) {
      const fileIdx = nextIdx++;
      args.push("-i", files[i]);
      if (!infos[i].hasAudio) {
        const anullIdx = nextIdx++;
        args.push("-f", "lavfi", "-t", String(Math.max(1, infos[i].duration)), "-i", "anullsrc=r=44100:cl=stereo");
        parts.push({ video: fileIdx, audio: anullIdx });
      } else {
        parts.push({ video: fileIdx, audio: fileIdx });
      }
    }

    const fc = [];
    const chainLabels = [];
    for (let i = 0; i < files.length; i++) {
      fc.push(
        `[${parts[i].video}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vi${i}]`
      );
      fc.push(`[${parts[i].audio}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[ai${i}]`);
      chainLabels.push(`[vi${i}][ai${i}]`);
    }
    fc.push(`${chainLabels.join("")}concat=n=${files.length}:v=1:a=1[v][a]`);

    const outFile = path.join(dir, "merged.mp4");
    args.push(
      "-filter_complex", fc.join(";"),
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-maxrate", "2M", "-bufsize", "4M",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-y", outFile
    );

    // 5) الدمج الفعلي (50% → 100%) — حد 150MB مضمون عبر maxrate + فحص نهائي
    job.progress = 50;
    const { code, stderr } = await run("ffmpeg", args, PROCESS_TIMEOUT_MS);
    if (code !== 0) {
      // نستخرج أسطر الخطأ الجوهرية فقط من فوضى سجل ffmpeg
      const errLines = stderr.split("\n").filter((l) =>
        /matches no streams|Error|Invalid|No such|Conversion failed|moov atom|Unable/i.test(l),
      );
      throw new Error(`ffmpeg failed: ${errLines.slice(-2).join(" | ").slice(0, 300) || `exit ${code}`}`);
    }

    const st = await fsp.stat(outFile);
    if (st.size > LIMITS.maxOutputBytes) throw new Error(`Output exceeds 150MB limit`);

    const outInfo = await ffprobe(outFile);
    job.state = "done";
    job.progress = 100;
    job.file = outFile;
    job.size = st.size;
    job.duration = Math.round(outInfo.duration * 100) / 100;
    job.resolution = `${outInfo.width}x${outInfo.height}`;
    job.doneAt = Date.now();
    console.log(`[merger] job ${job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${job.videos.length} clips, ${job.duration}s, ${job.resolution}, ${(st.size / 1048576).toFixed(1)}MB`);
  } catch (err) {
    fail(job, err?.message || String(err));
    console.error(`[merger] job ${job.id} failed:`, job.error);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    // تنظيف المقاطع المصدرية فورًا — نُبقي المخرج فقط
    for (const f of files) await fsp.rm(f, { force: true }).catch(() => {});
  }
}

/* ---------- الخدمة ---------- */

function authorized(req) {
  if (!MERGER_TOKEN) return true;
  const h = String(req.headers["authorization"] || "");
  return h === `Bearer ${MERGER_TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    return res.end();
  }

  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

  try {
    // الإعدادات — يستخدمها /api/health في التطبيق الرئيسي للتحقق من الجهوزية
    if (req.method === "GET" && p === "/api/config") {
      return send(res, 200, { limits: LIMITS, retentionHours: RETENTION_HOURS, version: "v2.1-ffmpeg" });
    }

    // إنشاء مهمة
    if (req.method === "POST" && p === "/api/jobs") {
      const raw = await readBody(req);
      let videos;
      try {
        videos = JSON.parse(raw || "{}").videos;
      } catch {
        return send(res, 400, { error: "Invalid JSON body" });
      }
      if (!Array.isArray(videos) || videos.length < 2) return send(res, 400, { error: "Videos must be >= 2" });
      if (videos.length > LIMITS.maxClips) return send(res, 400, { error: `Videos must be <= ${LIMITS.maxClips}` });
      if (videos.some((v) => typeof v !== "string" || !/^https?:\/\//i.test(v.trim()))) {
        return send(res, 400, { error: "Every entry must be an http(s) URL" });
      }
      const id = jobId();
      const job = {
        id,
        videos: videos.map((v) => v.trim()),
        state: "queued",
        progress: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + RETENTION_HOURS * 3600e3,
      };
      jobs.set(id, job);
      const u = urlsFor(job, req);
      return send(res, 200, {
        jobId: id,
        status: job.state,
        statusUrl: u.statusUrl,
        processUrl: u.processUrl,
        expiresAt: new Date(job.expiresAt).toISOString(),
      });
    }

    const m = p.match(/^\/api\/jobs\/([A-Za-z0-9-]+)(\/process|\/video)?$/);
    if (!m) return send(res, 404, { error: "Not found" });

    // استدعاء المعالجة الحاجب
    if (req.method === "POST" && m[2] === "/process") {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "Job not found (deleted or expired after 24h)" });
      if (job.state === "done") return send(res, 200, publicJob(job, req));
      if (job.state === "processing") return send(res, 409, { error: "Already processing" });
      try {
        await processJob(job, req);
        return send(res, 200, publicJob(job, req));
      } catch (err) {
        return send(res, 500, { error: job.error || err?.message || "Merge failed" });
      }
    }

    const job = jobs.get(m[1]);

    // حالة المهمة
    if (req.method === "GET" && !m[2]) {
      if (!job) return send(res, 404, { error: "Job not found (deleted or expired after 24h)" });
      return send(res, 200, publicJob(job, req));
    }

    // الملف المدموج
    if (req.method === "GET" && m[2] === "/video") {
      if (!job || job.state !== "done" || !job.file) return send(res, 404, { error: "Video not ready" });
      let st;
      try {
        st = await fsp.stat(job.file);
      } catch {
        return send(res, 404, { error: "Video file expired" });
      }
      const download = url.searchParams.get("download") === "1";
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": st.size,
        "Cache-Control": "private, max-age=3600",
        ...(download ? { "Content-Disposition": `attachment; filename="merged-${job.id}.mp4"` } : {}),
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(job.file).pipe(res);
      return;
    }

    // حذف فوري
    if (req.method === "DELETE" && !m[2]) {
      if (!job) return send(res, 404, { error: "Job not found" });
      jobs.delete(job.id);
      await fsp.rm(path.join(DATA_DIR, job.id), { recursive: true, force: true }).catch(() => {});
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(`[merger] ${req.method} ${p} error:`, err?.message || err);
    return send(res, 400, { error: err?.message || "Bad request" });
  }
});

/* ---------- التنظيف التلقائي بعد 24 ساعة ---------- */

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now > job.expiresAt && job.state !== "processing") {
      jobs.delete(id);
      fsp.rm(path.join(DATA_DIR, id), { recursive: true, force: true }).catch(() => {});
    }
  }
}, 10 * 60_000).unref();

server.listen(PORT, () => {
  console.log(`[merger] Video Merger API v2 listening on http://localhost:${PORT}`);
  console.log(`[merger] data dir: ${DATA_DIR} | limits: ${LIMITS.maxClips} clips / ${LIMITS.maxSourceBytes / 1048576}MB source / ${LIMITS.maxOutputBytes / 1048576}MB output / ${LIMITS.maxTotalDurationSec}s | retention: ${RETENTION_HOURS}h`);
  console.log(`[merger] auth: ${MERGER_TOKEN ? "Bearer token enabled" : "open (set MERGER_TOKEN to protect)"}`);
});
