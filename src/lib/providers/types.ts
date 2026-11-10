// أنواع مشتركة لطبقة المزودين — بلا أي اعتماديات لتجنب الدوران
import type { ProviderId } from "../models";

export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

// مرجع مفتاح مُمرَّر للمزودين (بدون حقول إدارة)
export interface KeyRef {
  id: string;
  provider: ProviderId;
  api_key: string;
  label: string;
}

// خطأ من مزود خارجي — يُصنَّف لاحقًا عبر classifyProviderError
export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export interface CheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number;
}

// واجهة المزودات الموحدة (المواصفة §5.2)
export interface ProviderAdapter {
  // مهمة غير متزامنة (فيديو، وبعض الصور): تعيد providerTaskId
  createTask(key: KeyRef, model: string, input: Record<string, unknown>): Promise<{ providerTaskId: string }>;
  // صور متزامنة إن كان المزود يدعمها (CometAPI تعيد النتيجة فورًا)
  createImageSync?(key: KeyRef, model: string, input: Record<string, unknown>): Promise<{ urls: string[] }>;
  // استعلام حالة مهمة جارية
  checkTask(key: KeyRef, providerTaskId: string): Promise<CheckResult>;
}

// سجل محاولة واحدة (نجاح أو فشل) يُخزَّن في attempts_json
export interface AttemptEntry {
  provider: string;
  keyId: string;
  keyLabel: string;
  ok: boolean;
  errorClass?: ErrorClass;
  error?: string;
  at: string;
}
