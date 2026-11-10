// فهرس المزودات — الوصول الموحد بالاسم
import type { ProviderId } from "../models";
import type { ProviderAdapter } from "./types";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}

export * from "./types";
