"use client";

// بطاقة أ) مدير المفاتيح — إضافة/تعطيل/تنشيط/حذف مع إخفاء إلزامي للمفاتيح
import { useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, Power, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeyStatusBadge, formatTime, type KeyDto, type KeyStatus } from "./bits";

export function KeysCard({ refreshTick }: { refreshTick: number }) {
  const [keys, setKeys] = useState<KeyDto[] | null>(null);
  const [provider, setProvider] = useState("kie");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/keys", { cache: "no-store" });
      const j = await r.json();
      setKeys(j.keys ?? []);
    } catch {
      setKeys([]);
    }
  };

  useEffect(() => {
    void load();
  }, [refreshTick]);

  const add = async () => {
    setMsg(null);
    if (!apiKey.trim()) {
      setMsg({ kind: "err", text: "أدخل مفتاح API أولًا." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), label: label.trim() }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: j.error ?? "تعذر إضافة المفتاح." });
      } else {
        setMsg({ kind: "ok", text: "أُضيف المفتاح بنجاح — سيُجرَّب حسب ترتيب الإضافة التسلسلي." });
        setApiKey("");
        setLabel("");
        await load();
      }
    } catch {
      setMsg({ kind: "err", text: "خطأ في الشبكة أثناء الإضافة." });
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, status: KeyStatus) => {
    await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="size-5 text-emerald-600" />
          مدير المفاتيح
        </CardTitle>
        <CardDescription>
          أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* نموذج الإضافة */}
        <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="provider">المزود</Label>
            <Select value={provider} onValueChange={setProvider} dir="rtl">
              <SelectTrigger id="provider" className="w-full bg-white">
                <SelectValue placeholder="اختر المزود" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie">kie.ai</SelectItem>
                <SelectItem value="cometapi">CometAPI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label">تسمية (اختياري)</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: حساب رئيسي" className="bg-white" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="apiKey">المفتاح</Label>
            <div className="flex gap-2">
              <Input
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="الصق مفتاح API كاملًا هنا"
                className="bg-white font-mono text-sm"
                dir="ltr"
              />
              <Button onClick={add} disabled={busy} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0">
                <Plus className="size-4" />
                {busy ? "جارٍ الإضافة…" : "إضافة"}
              </Button>
            </div>
          </div>
          {msg && (
            <p className={`text-sm sm:col-span-2 ${msg.kind === "ok" ? "text-emerald-700" : "text-red-600"}`} role="status">
              {msg.kind === "ok" ? "✅ " : "❌ "}
              {msg.text}
            </p>
          )}
        </div>

        {/* قائمة المفاتيح */}
        {keys === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">
            لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لتبدأ التوليد.
          </p>
        ) : (
          <ScrollArea className="max-h-96 overflow-y-auto rounded-lg">
            <ul className="space-y-2 pe-1">
              {keys.map((k, i) => (
                <li key={k.id} className="rounded-xl border bg-white p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {i + 1}
                    </span>
                    <span className="font-mono text-sm" dir="ltr">
                      {k.api_key}
                    </span>
                    <KeyStatusBadge status={k.status} />
                    <span className="text-xs text-slate-500">{k.provider === "kie" ? "kie.ai" : "CometAPI"}</span>
                    {k.label && <span className="text-xs text-slate-500">• {k.label}</span>}
                    <span className="ms-auto flex gap-1">
                      {k.status === "disabled" ? (
                        <Button variant="outline" size="sm" onClick={() => patch(k.id, "active")} className="gap-1 h-8">
                          <Power className="size-3.5 text-emerald-600" />
                          تنشيط
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => patch(k.id, "disabled")} className="gap-1 h-8">
                          <Power className="size-3.5 text-slate-500" />
                          تعطيل
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => remove(k.id)}
                        className="gap-1 h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                        aria-label={`حذف المفتاح ${k.label || k.api_key}`}
                      >
                        <Trash2 className="size-3.5" />
                        حذف
                      </Button>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>الاستخدام: <b className="text-slate-700">{k.usage_count}</b></span>
                    <span>نجاح: <b className="text-emerald-700">{k.success_count}</b></span>
                    <span>فشل: <b className="text-red-600">{k.fail_count}</b></span>
                    <span>آخر استخدام: {formatTime(k.last_used_at)}</span>
                    {k.last_error && <span className="w-full text-red-600/90">آخر خطأ: {k.last_error.slice(0, 140)}</span>}
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
