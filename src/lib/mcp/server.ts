// خادم MCP — الأدوات الخمس عبر SDK الرسمي (@modelcontextprotocol/sdk)
// الأوصاف إنجليزية دقيقة (يقرأها العميل)، ونتائج الاستدعاء عربية.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { after } from "next/server";
import { MODELS, IMAGE_CANONICAL, VIDEO_CANONICAL, SEEDANCE_FAST_CANONICAL, SEEDANCE_MINI_CANONICAL, type ModelDef } from "../models";
import {
  startGeneration,
  startMerge,
  refreshTask,
  pumpQueue,
  listMedia,
  NoKeysError,
  ParamsRejection,
} from "../coordinator";
import { formatTaskForModel, formatNoKeys, formatMediaList } from "../format";

export const SERVER_INFO = { name: "media-generator-mcp", version: "1.3.0" } as const;

// قوائم موديلات الأدوات تُشتق من سجل الموديلات — موديل جديد يظهر تلقائيًا بلا تعديل هنا
function modelEnumOf(type: ModelDef["type"]): [string, ...string[]] {
  const names = MODELS.filter((m) => m.type === type).flatMap((m) => [m.canonical, ...m.aliases]);
  return [...new Set(names)] as [string, ...string[]];
}

// نص التوجيهات الجاهز المُرسل مع initialize — يحمل قواعد المتابعة والتبديل الصامت
export const SERVER_INSTRUCTIONS = `AI media generation server (free images + kie.ai/CometAPI video with automatic sequential multi-key failover, plus video merging).
Images are generated FREE by default (no API key, no credits needed); if the free service is unavailable the server automatically falls back to the configured paid keys.
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Pending tasks also resume automatically in the background whenever any server activity occurs (polling, dashboard, new keys) — just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// ردود الأخطاء الموحدة: لا مفاتيح ولا رصيد تخرج للعميل أبدًا
function toolError(err: unknown): ToolResult {
  if (err instanceof NoKeysError) return textResult(formatNoKeys(err.model), true);
  if (err instanceof ParamsRejection) return textResult(err.arabicMessage, true);
  const msg = (err as Error)?.message ?? String(err);
  return textResult(`❌ خطأ داخلي غير متوقع: ${msg.slice(0, 200)}`, true);
}

// استخراج progressToken من _meta — بث تقدم حي فقط لمن زوّده
function progressTokenOf(extra: unknown): string | number | undefined {
  const e = extra as
    | { _meta?: { progressToken?: string | number }; meta?: { progressToken?: string | number }; requestInfo?: { _meta?: { progressToken?: string | number } } }
    | undefined;
  return e?._meta?.progressToken ?? e?.meta?.progressToken ?? e?.requestInfo?._meta?.progressToken;
}

function notifyFactory(extra: unknown): ((message: string, progress: number, total: number) => void) | undefined {
  const token = progressTokenOf(extra);
  const send = (extra as { sendNotification?: (n: unknown) => Promise<void> } | undefined)?.sendNotification;
  if (token === undefined || typeof send !== "function") return undefined;
  return (message: string, progress: number, total: number) => {
    void Promise.resolve(
      send({ method: "notifications/progress", params: { progressToken: token, progress, total, message } }),
    ).catch(() => {});
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

  /* 1) generate_image */
  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description:
        "Generate an image — FREE by default (Flux, no API key and no credits needed). Set model to 'gpt-image-2-6/flare-text-to-image' only if you specifically need the paid GPT-image quality. Automatic silent failover across all active API keys and the free provider. Returns the ready image URL if it completes within the wait window; otherwise returns a task_id — call get_task every ~10 seconds until completed, then show the URL and stop.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to draw. Detailed prompts give better results."),
        model: z.enum(modelEnumOf("image")).default(IMAGE_CANONICAL),
        aspect_ratio: z
          .enum(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"])
          .default("auto"),
        resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
        background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("Only applied at 1K."),
        output_format: z.enum(["png", "jpeg", "webp", "gif"]).default("png"),
        wait_seconds: z.number().int().min(0).max(240).default(90),
      },
    },
    async (args, extra) => {
      try {
        const row = await startGeneration({
          type: "image",
          prompt: args.prompt,
          params: { ...args },
          waitSeconds: args.wait_seconds,
          notify: notifyFactory(extra),
        });
        return textResult(formatTaskForModel(row), row.status === "failed");
      } catch (err) {
        return toolError(err);
      }
    },
  );

  /* 2) generate_video */
  server.registerTool(
    "generate_video",
    {
      title: "Generate video",
      description:
        `Generate a video. Default model ${SEEDANCE_FAST_CANONICAL} (fastest, usually under ~2 minutes; select '${SEEDANCE_MINI_CANONICAL}' for the cheapest option, or '${VIDEO_CANONICAL}' for native synchronized dialogue audio). Videos are limited to short durations to protect the prepaid balance. Optional image-to-video via image_url. A short wait with live progress streaming returns a task_id — track it with get_task every ~10 seconds until completed, then show the URL and stop.`,
      inputSchema: {
        prompt: z
          .string()
          .max(4096)
          .describe("Scene description. With the grok model, dialogue in the prompt is spoken in the video."),
        image_url: z.string().optional().describe("Optional public image URL as the first frame (image-to-video)."),
        model: z.enum(modelEnumOf("video")).default(SEEDANCE_FAST_CANONICAL),
        aspect_ratio: z.enum(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]).default("auto"),
        resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
        enable_audio: z
          .boolean()
          .default(true)
          .describe(
            "Kept for compatibility: audio behavior is native to each model (grok embeds synchronized audio; seedance generates its own sound), so this flag is ignored.",
          ),
        duration: z.number().int().min(1).max(15).default(8).describe("Duration in seconds."),
        wait_seconds: z.number().int().min(0).max(240).default(25),
      },
    },
    async (args, extra) => {
      try {
        const { image_url, ...rest } = args;
        const params: Record<string, unknown> = { ...rest };
        if (image_url !== undefined && image_url !== "") params.image_url = image_url;
        const row = await startGeneration({
          type: "video",
          prompt: args.prompt,
          params,
          waitSeconds: args.wait_seconds,
          notify: notifyFactory(extra),
        });
        return textResult(formatTaskForModel(row), row.status === "failed");
      } catch (err) {
        return toolError(err);
      }
    },
  );

  /* 3) merge_videos */
  server.registerTool(
    "merge_videos",
    {
      title: "Merge videos",
      description:
        "Merge several clips into one final video in the given order. Pass 'urls' (direct public video links, like the ones from generate_video) or 'task_ids' (completed video tasks resolved from the database in order — ideal after generating several clips). 2 to 10 clips. Merging is usually fast: a short wait with live progress, then a merge task_id — track it with get_task. the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.",
      inputSchema: {
        // ملاحظة قرار: بلا min/max في المخطط — التحقق داخل الأداة يرسل الرسائل العربية الصحيحة
        // (رفض مقطع واحد وأكثر من 10)، والحد موثّق في الوصف أعلاه.
        urls: z
          .array(z.string())
          .optional()
          .describe("Public direct video URLs (http/https) in merge order — 2 to 10 clips; the first clip starts the final video."),
        task_ids: z
          .array(z.string())
          .optional()
          .describe("Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order (2 to 10)."),
        wait_seconds: z.number().int().min(0).max(240).default(60),
      },
    },
    async (args, extra) => {
      try {
        const row = await startMerge({
          urls: args.urls,
          task_ids: args.task_ids,
          waitSeconds: args.wait_seconds,
          notify: notifyFactory(extra),
        });
        return textResult(formatTaskForModel(row), row.status === "failed");
      } catch (err) {
        return toolError(err);
      }
    },
  );

  /* 4) get_task */
  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description:
        "Track any task by its id — image/video generation and merging (reads the database and live-updates from the provider or the merging service while running). Poll every ~10 seconds; when completed you will find the result URLs — show them to the user and stop polling.",
      inputSchema: {
        task_id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        const row = await refreshTask(args.task_id);
        // مضخة الطابور: كل نداء get_task يستأنف مهمة عالقة أخرى في الخلفية
        // (بعد إرسال الرد — لا يضيف أي تأخير على هذا النداء)
        try {
          after(async () => {
            await pumpQueue(1).catch(() => {});
          });
        } catch {}
        if (!row) return textResult(`❌ لم يتم العثور على مهمة بالمعرّف: ${args.task_id}`, true);
        return textResult(formatTaskForModel(row), row.status === "failed");
      } catch (err) {
        return toolError(err);
      }
    },
  );

  /* 5) list_media */
  server.registerTool(
    "list_media",
    {
      title: "List media",
      description:
        "Latest images/videos/merges stored with their URLs from the database (no regeneration) — to recall previously generated media.",
      inputSchema: {
        type: z.enum(["image", "video", "merge"]).optional(),
        status: z.enum(["completed", "failed", "processing"]).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async (args) => {
      try {
        const rows = await listMedia({ type: args.type, status: args.status, limit: args.limit ?? 10 });
        return textResult(formatMediaList(rows));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}
