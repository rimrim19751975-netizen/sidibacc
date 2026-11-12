// اختبار تصنيف الأخطاء الحقيقي — خاصة رسالة pre-consume quota الخاصة بـ CometAPI
import { classifyProviderError } from "../src/lib/keys";

const cases: Array<{
  name: string;
  status: number | undefined;
  message: string;
  expected: "disabled" | "exhausted" | "provider" | "params" | "temporary";
}> = [
  {
    name: "CometAPI pre-consume quota failed (رسالة المستخدم الفعلية 2026-11-12)",
    status: 429,
    message:
      "pre-consume quota failed, organization and owner combined remaining quota: ＄0.609344, need: ＄1.620000",
    expected: "exhausted",
  },
  {
    name: "pre-consume ملفوف داخل 403 (المُختبر فعليًا على /grok/v1/videos) — يجب exhausted لا disabled",
    status: 403,
    message:
      "pre-consume quota failed, organization and owner combined remaining quota: ＄0.612376, need: ＄0.840000",
    expected: "exhausted",
  },
  {
    name: "403 بلا رسالة رصيد صريحة → disabled",
    status: 403,
    message: "Forbidden",
    expected: "disabled",
  },
  {
    name: "نفس الرسالة بحالة 400",
    status: 400,
    message:
      "pre-consume quota failed. organization and owner combined remaining quota: $0.617680, need $1.620000",
    expected: "exhausted",
  },
  { name: "Credits insufficient (kie)", status: 500, message: "Credits insufficient : Your current balance isn’t enough to run this request. Please top up to continue.", expected: "exhausted" },
  { name: "invalid api key بحالة 500", status: 500, message: "Invalid API key provided", expected: "disabled" },
  { name: "unauthorized 401", status: 401, message: "Unauthorized – Authentication failed", expected: "disabled" },
  { name: "429 rate limit بلا إشارة رصيد", status: 429, message: "rate limit exceeded, slow down", expected: "temporary" },
  { name: "500 بلا إشارة رصيد", status: 500, message: "Internal server error", expected: "temporary" },
  { name: "quota بحالة 400", status: 400, message: "monthly quota exceeded", expected: "exhausted" },
  { name: "need $X pattern", status: 500, message: "request rejected: need: ＄2.500000", expected: "exhausted" },
  { name: "model not found", status: 400, message: "model not found: foo-bar", expected: "provider" },
  { name: "bad params", status: 400, message: "prompt is required", expected: "params" },
  { name: "network timeout", status: undefined, message: "fetch failed: network timeout", expected: "temporary" },
];

let pass = 0;
for (const c of cases) {
  const got = classifyProviderError(c.status, c.message);
  const ok = got === c.expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${c.name}: expected=${c.expected} got=${got}`);
}
console.log(`\n${pass}/${cases.length} ناجحة`);
process.exit(pass === cases.length ? 0 : 1);
