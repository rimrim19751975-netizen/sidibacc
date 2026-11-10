"use client";

// عناصر واجهة مشتركة صغيرة للوحة الإدارة
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type KeyStatus = "active" | "exhausted" | "disabled";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export type TaskType = "image" | "video" | "merge";

export interface KeyDto {
  id: string;
  provider: string;
  label: string;
  api_key: string; // مُقنَّع دائمًا من السيرفر
  status: KeyStatus;
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface TaskDto {
  id: string;
  type: TaskType;
  model: string;
  provider: string | null;
  status: TaskStatus;
  progress: number;
  prompt: string;
  resultUrls: string[];
  errorMessage: string | null;
  attemptsCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface HealthDto {
  ok: boolean;
  database: string;
  mcpEndpoint: string;
  models: { canonical: string; type: string; providers: string[] }[];
  merger: { base: string | null; healthy: boolean };
  authRequired: boolean;
}

export function KeyStatusBadge({ status }: { status: KeyStatus }) {
  if (status === "active") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">نشط</Badge>;
  if (status === "exhausted") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">مستنزف (402)</Badge>;
  return <Badge className="bg-slate-200 text-slate-600 border-slate-300 hover:bg-slate-200">معطّل</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  if (status === "completed") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">✅ مكتملة</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">❌ فاشلة</Badge>;
  return <Badge className="bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-100">⏳ جارية</Badge>;
}

export function TaskTypeBadge({ type }: { type: TaskType }) {
  if (type === "image") return <Badge variant="outline" className="border-violet-300 text-violet-700">صورة</Badge>;
  if (type === "video") return <Badge variant="outline" className="border-teal-300 text-teal-700">فيديو</Badge>;
  return <Badge variant="outline" className="border-orange-300 text-orange-700">دمج</Badge>;
}

export function ProviderBadge({ provider }: { provider: string }) {
  if (provider === "kie") return <Badge variant="outline">kie.ai</Badge>;
  if (provider === "cometapi") return <Badge variant="outline">CometAPI</Badge>;
  if (provider === "merger") return <Badge variant="outline">Merger</Badge>;
  return <Badge variant="outline">{provider || "—"}</Badge>;
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ar", { dateStyle: "short", timeStyle: "short" }).format(d);
  } catch {
    return iso;
  }
}

export function CopyButton({ text, label = "نسخ" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // بديل للمتصفحات التي تمنع الحافظة خارج HTTPS
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="gap-1.5 shrink-0">
      {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      {done ? "تم النسخ" : label}
    </Button>
  );
}
