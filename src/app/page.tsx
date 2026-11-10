"use client";

// لوحة الإدارة العربية — ثلاث بطاقات: المفاتيح، المهام، ربط السيرفر
import { useCallback, useEffect, useState } from "react";
import { Activity, Database, ShieldCheck } from "lucide-react";
import { KeysCard } from "@/components/dashboard/keys-card";
import { TasksCard } from "@/components/dashboard/tasks-card";
import { ConnectCard } from "@/components/dashboard/connect-card";
import type { HealthDto, KeyDto, TaskDto } from "@/components/dashboard/bits";

interface Stats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

export default function Home() {
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch {
      setHealth(null);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks?limit=25", { cache: "no-store" });
      const j = await r.json();
      setTasks(j.tasks ?? []);
      setStats(j.stats ?? null);
    } catch {
      /* تجاهل — تُعاد المحاولة في الدورة التالية */
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadTasks();
    const t = setInterval(loadTasks, 5000); // لوحة المهام تتحدث كل ~5 ثوانٍ
    const h = setInterval(loadHealth, 15000);
    return () => {
      clearInterval(t);
      clearInterval(h);
    };
  }, [loadHealth, loadTasks]);

  // تحديث قائمة المفاتيح بعد كل تغيير — عبر tick تُمرَّر لبطاقة المفاتيح
  const bumpKeys = useCallback(() => setRefreshTick((x) => x + 1), []);

  const dbOk = health?.ok === true;

  return (
    <div className="min-h-screen">
      {/* الهيدر */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Activity className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">MCP Media Generator</h1>
              <p className="text-xs text-slate-500">خادم توليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع</p>
            </div>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {health === null ? (
              <span className="rounded-full border bg-slate-50 px-3 py-1 text-xs text-slate-500">… جارٍ فحص الحالة</span>
            ) : dbOk ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <Database className="size-3.5" />
                Turso متصل
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                <Database className="size-3.5" />
                قاعدة البيانات غير متصلة
              </span>
            )}
            {health && (
              <span
                className={`hidden rounded-full border px-3 py-1 text-xs sm:inline-flex ${
                  health.merger.healthy
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                خدمة الدمج: {health.merger.healthy ? "جاهزة" : "غير مضبوطة"}
              </span>
            )}
            {health?.authRequired && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                <ShieldCheck className="size-3.5" />
                /mcp محمي بتوكن
              </span>
            )}
          </div>
        </div>
      </header>

      {/* البطاقات الثلاث */}
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <KeysCard refreshTick={refreshTick} />
          <TasksCard tasks={tasks} stats={stats} />
        </div>
        <ConnectCard health={health} />
      </main>

      {/* تذييل لاصق بالأسفل عند الصفحات القصيرة */}
      <footer className="mt-auto">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-slate-400">
          MCP Media Generator — روابط فقط: لا تُنزَّل أي وسائط على السيرفر، وتُخزَّن روابط النتائج في قاعدة البيانات فقط.
        </div>
      </footer>
    </div>
  );
}
