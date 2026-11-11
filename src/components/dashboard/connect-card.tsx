"use client";

// بطاقة ج) ربط السيرفر — رابط MCP + إعدادات جاهزة للنسخ لكل عميل + رقائق الأدوات
import { useEffect, useState } from "react";
import { Plug, KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "./bits";
import type { HealthDto } from "./bits";

const TOOLS: { name: string; desc: string }[] = [
  { name: "generate_image", desc: "توليد صورة من وصف نصي" },
  { name: "generate_video", desc: "توليد فيديو بصوت متزامن (مع صورة أولى اختيارية)" },
  { name: "merge_videos", desc: "دمج عدة مقاطع في مقطع واحد بالترتيب" },
  { name: "get_task", desc: "متابعة أي مهمة بمعرّفها حتى الاكتمال" },
  { name: "list_media", desc: "استرجاع أحدث الوسائط المخزنة بروابطها" },
];

export function ConnectCard({ health }: { health: HealthDto | null }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // الأصل يُقرأ في المتصفح بعد التحميل — خارج نداء التأثير المتزامن (قاعدة react-hooks)
    const id = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(id);
  }, []);
  const mcpUrl = `${origin}/mcp`;
  const authRequired = health?.authRequired ?? false;
  const headersBlock = authRequired ? `,\n        "headers": { "Authorization": "Bearer <MCP_ACCESS_TOKEN>" }` : "";

  const chatgptJson = `{
  "mcpServers": {
    "media-generator": {
      "url": "${mcpUrl}"${headersBlock}
    }
  }
}`;
  const claudeJson = `{
  "mcpServers": {
    "media-generator": {
      "type": "http",
      "url": "${mcpUrl}"${headersBlock}
    }
  }
}`;
  const cursorJson = `{
  "mcpServers": {
    "media-generator": {
      "url": "${mcpUrl}"${headersBlock}
    }
  }
}`;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Plug className="size-5 text-emerald-600" />
          ربط السيرفر
        </CardTitle>
        <CardDescription>اربط أي عميل MCP برابط واحد — الإعدادات جاهزة للنسخ أدناه.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* رابط MCP */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700" htmlFor="mcpUrl">
            رابط خادم MCP
          </label>
          <div className="flex gap-2">
            <Input id="mcpUrl" readOnly value={mcpUrl} dir="ltr" className="font-mono text-sm bg-white" />
            <CopyButton text={mcpUrl} />
          </div>
          {authRequired && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <KeyRound className="size-3.5" />
              السيرفر محمي بـ MCP_ACCESS_TOKEN — أضف ترويسة Authorization في كل إعداد أدناه (استبدل العنصر النائب بالتوكن).
            </p>
          )}
        </div>

        {/* إعدادات العملاء */}
        <Tabs defaultValue="chatgpt" dir="rtl">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chatgpt">ChatGPT / GPT Agents</TabsTrigger>
            <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
            <TabsTrigger value="cursor">Cursor / Windsurf / Cline</TabsTrigger>
          </TabsList>
          <TabsContent value="chatgpt" className="space-y-2">
            <p className="text-xs text-slate-500">
              في ChatGPT: Settings → Connectors → Create → Custom MCP server — ضع الرابط في «Server URL» ثم ألصق JSON الإعداد.
            </p>
            <div className="relative">
              <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-emerald-100" dir="ltr">
                {chatgptJson}
              </pre>
              <span className="absolute end-2 top-2">
                <CopyButton text={chatgptJson} />
              </span>
            </div>
          </TabsContent>
          <TabsContent value="claude" className="space-y-2">
            <p className="text-xs text-slate-500">الصق هذا في claude_desktop_config.json.</p>
            <div className="relative">
              <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-emerald-100" dir="ltr">
                {claudeJson}
              </pre>
              <span className="absolute end-2 top-2">
                <CopyButton text={claudeJson} />
              </span>
            </div>
          </TabsContent>
          <TabsContent value="cursor" className="space-y-2">
            <p className="text-xs text-slate-500">الصق هذا في mcp.json (Cursor / Windsurf / Cline).</p>
            <div className="relative">
              <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-emerald-100" dir="ltr">
                {cursorJson}
              </pre>
              <span className="absolute end-2 top-2">
                <CopyButton text={cursorJson} />
              </span>
            </div>
          </TabsContent>
        </Tabs>

        {/* رقائق الأدوات */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">الأدوات الخمس المتاحة</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TOOLS.map((t) => (
              <li key={t.name} className="flex items-start gap-2 rounded-lg border bg-slate-50 px-3 py-2">
                <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300" dir="ltr">
                  {t.name}
                </code>
                <span className="text-xs text-slate-600">{t.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ملاحظة كهرمانية */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800" role="note">
          ⚠️ الفيديو يحتاج دقائق: يعيد السيرفر task_id فورًا، ويتابَع تلقائيًا بـ get_task كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض
          الرابط في الدردشة ويتوقف. أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
        </div>
      </CardContent>
    </Card>
  );
}
