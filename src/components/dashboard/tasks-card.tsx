"use client";

// بطاقة ب) لوحة المهام — إحصائيات + أحدث المهام بتحديث حي كل ~5 ثوانٍ
import { ExternalLink, ListVideo } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProgressBar, TaskStatusBadge, TaskTypeBadge, ProviderBadge, formatTime, type TaskDto } from "./bits";

interface Stats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${tone}`}>
      <div className="text-2xl font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-xs text-slate-600">{label}</div>
    </div>
  );
}

export function TasksCard({ tasks, stats }: { tasks: TaskDto[] | null; stats: Stats | null }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListVideo className="size-5 text-emerald-600" />
          لوحة المهام
        </CardTitle>
        <CardDescription>أحدث المهام — تُحدَّث تلقائيًا كل ~5 ثوانٍ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats === null ? (
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <StatChip label="الإجمالي" value={stats.total} tone="bg-slate-50 border-slate-200" />
            <StatChip label="مكتملة" value={stats.completed} tone="bg-emerald-50 border-emerald-200" />
            <StatChip label="فاشلة" value={stats.failed} tone="bg-red-50 border-red-200" />
            <StatChip label="جارية" value={stats.processing} tone="bg-sky-50 border-sky-200" />
          </div>
        )}

        {tasks === null ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">
            لا توجد مهام بعد — استخدم generate_image أو generate_video من أي عميل MCP.
          </p>
        ) : (
          <ScrollArea className="max-h-96 overflow-y-auto rounded-lg">
            <ul className="space-y-2 pe-1">
              {tasks.map((t) => (
                <li key={t.id} className="rounded-xl border bg-white p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskTypeBadge type={t.type} />
                    <TaskStatusBadge status={t.status} />
                    <ProviderBadge provider={t.provider ?? ""} />
                    <span className="font-mono text-[11px] text-slate-400" dir="ltr">
                      {t.model}
                    </span>
                    <span className="ms-auto text-xs text-slate-400">{formatTime(t.createdAt)}</span>
                  </div>
                  {t.status === "processing" && (
                    <div className="space-y-1">
                      <ProgressBar value={t.progress} />
                      <div className="text-[11px] text-slate-500">التقدم: {t.progress}%</div>
                    </div>
                  )}
                  {t.prompt && (
                    <p className="line-clamp-2 text-sm text-slate-600" title={t.prompt}>
                      {t.prompt}
                    </p>
                  )}
                  {t.status === "completed" && t.resultUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {t.resultUrls.slice(0, 3).map((u, i) => (
                        <a
                          key={i}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                        >
                          <ExternalLink className="size-3" />
                          فتح النتيجة {t.resultUrls.length > 1 ? `#${i + 1}` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                  {t.status === "failed" && t.errorMessage && (
                    <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{t.errorMessage}</p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="font-mono" dir="ltr">
                      id: {t.id.slice(0, 8)}…
                    </span>
                    <span>محاولات: {t.attemptsCount}</span>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
