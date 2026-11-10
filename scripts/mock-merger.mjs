// محاكي خدمة دمج الفيديو — Video Merger API v2
// يُستخدم لاختبار مسار الدمج محليًا عند غياب رابط الخدمة الحقيقية (MERGER_API_BASE).
// النقاط المُحاكاة وفق الأشكال الحقيقية الموثقة في المواصفة §7:
//   GET  /api/config
//   POST /api/jobs
//   POST /api/jobs/{id}/process  (blocking ~2s في المحاكي)
//   GET  /api/jobs/{id}
//   GET  /api/jobs/{id}/video
//   DELETE /api/jobs/{id}
import http from "node:http";

const PORT = 8787;
const jobs = new Map();
let seq = 0;

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(data);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/config") {
    return send(res, 200, {
      limits: { maxClips: 10, maxSourceBytes: 200 * 1024 * 1024, maxOutputBytes: 150 * 1024 * 1024, maxTotalDurationSec: 600 },
      retentionHours: 24,
    });
  }

  if (req.method === "POST" && path === "/api/jobs") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { videos } = JSON.parse(body || "{}");
        if (!Array.isArray(videos) || videos.length < 2) return send(res, 400, { error: "Videos must be >= 2" });
        if (videos.length > 10) return send(res, 400, { error: "Videos must be <= 10" });
        const jobId = `mock${String(++seq).padStart(9, "0")}`;
        jobs.set(jobId, { videos, createdAt: Date.now(), processed: false, done: false });
        return send(res, 200, {
          jobId,
          status: "queued",
          statusUrl: `http://localhost:${PORT}/api/jobs/${jobId}`,
          processUrl: `http://localhost:${PORT}/api/jobs/${jobId}/process`,
          expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
        });
      } catch {
        return send(res, 400, { error: "Invalid JSON body" });
      }
    });
    return;
  }

  const m = path.match(/^\/api\/jobs\/([^/]+)(\/process|\/video)?$/);
  if (m) {
    const jobId = m[1];
    const job = jobs.get(jobId);
    if (req.method === "DELETE" && !m[2]) {
      const existed = jobs.delete(jobId);
      return send(res, existed ? 200 : 404, existed ? { ok: true } : { error: "Job not found" });
    }
    if (!job) return send(res, 404, { error: "Job not found" });

    if (req.method === "POST" && m[2] === "/process") {
      // يستغرق ثانيتين ثم ينجح (محاكاة المعالجة الحاجبة)
      setTimeout(() => {
        job.processed = true;
        job.done = true;
        send(res, 200, {
          status: "done",
          videoUrl: `http://localhost:${PORT}/api/jobs/${jobId}/video`,
          downloadUrl: `http://localhost:${PORT}/api/jobs/${jobId}/video?download=1`,
          size: 1234567,
          duration: 30.2,
          resolution: "640x360",
          expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
        });
      }, 2000);
      return;
    }

    if (req.method === "GET" && !m[2]) {
      if (job.done) {
        return send(res, 200, {
          status: "done",
          progress: 100,
          videoUrl: `http://localhost:${PORT}/api/jobs/${jobId}/video`,
          downloadUrl: `http://localhost:${PORT}/api/jobs/${jobId}/video?download=1`,
        });
      }
      // progress كسر 0..1 لاختبار التحويل الدفاعي
      return send(res, 200, { status: "queued", progress: 0.4 });
    }

    if (req.method === "GET" && m[2] === "/video") {
      // ملف MP4 صغير حقيقي للعرض (بايتات كافية لفحص الاستجابة)
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "64" });
      return res.end(Buffer.from("ftypmp42fake-video-bytes-for-mock-test0000000000", "utf8"));
    }
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`[mock-merger] listening on http://localhost:${PORT}`));
