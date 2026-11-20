import { costOf } from './pricing.js';
import type { ResolvedCaps } from './pricing.js';
import type { SpendGuard } from './loop.js';
import { estimateTokens, type ChatRequest, type ChatResponse, type ModelProvider } from './providers/types.js';
import type { Price, ProviderId } from './types.js';
import { recordSpend, spentToday, type LedgerOptions } from './usage.js';

const ESTIMATE_MARGIN = 1.3;

const money = (n: number): string => `$${n.toFixed(2)}`;
const amount = (n: number, unit: 'usd' | 'tokens'): string => (unit === 'usd' ? money(n) : `${Math.round(n).toLocaleString('en-US')} tokens`);

/**
 * Enforces the run and day caps. Every call reserves its worst case (the full prompt at the uncached rate plus the full
 * `max_tokens` as output) BEFORE it is sent, and the reservation is counted against the caps for every other call in flight,
 * so parallel work cannot overshoot. When the real usage arrives the reservation is replaced by what was actually spent.
 */
export class BudgetTracker implements SpendGuard {
  private readonly reserved = new Map<ChatRequest, number>();
  private runUsd = 0;
  private runTokens = 0;
  private requests = 0;
  private readonly ledger: LedgerOptions;

  constructor(private readonly o: {
    provider: ModelProvider;
    providerId: ProviderId;
    model: string;
    caps: ResolvedCaps;
    home?: string;
    now?: () => Date;
    /** Price to bill with when a fallback model ran (the real model is not reported), e.g. the priciest model. */
    fallbackPrice?: Price;
  }) {
    this.ledger = { ...(o.home ? { home: o.home } : {}), ...(o.now ? { now: o.now } : {}) };
  }

  private unit(): 'usd' | 'tokens' {
    return this.o.caps.unit;
  }

  /** Spent so far this run (what was charged, not what is reserved). */
  runSpend(): { usd: number; tokens: number } {
    return { usd: this.runUsd, tokens: this.runTokens };
  }

  private reservedTotal(): number {
    let n = 0;
    for (const v of this.reserved.values()) n += v;
    return n;
  }

  private daySpent(): number {
    const d = spentToday(this.o.providerId, this.ledger);
    return this.unit() === 'usd' ? d.usd : d.tokens;
  }

  /** The day's cap is used up: starting a run is pointless. */
  dayExhausted(): boolean {
    return this.daySpent() >= this.o.caps.day;
  }

  async beforeCall(request: ChatRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
    const caps = this.o.caps;
    const caller = this.o.provider;
    const exact = caller.capabilities(request.model).exactTokenCount;
    const counted = exact ? (await caller.countTokens(request)).tokens : Math.ceil(estimateTokens(request) * ESTIMATE_MARGIN);
    const worstPrice = this.worstPrice();
    const worst = caps.unit === 'usd' && worstPrice ? costOf({ inputTokens: counted, outputTokens: request.maxTokens }, worstPrice) : counted + request.maxTokens;
    const spentRun = this.unit() === 'usd' ? this.runUsd : this.runTokens;
    const reserved = this.reservedTotal();
    if (spentRun + reserved + worst > caps.run) {
      return { ok: false, reason: `run cap ${amount(caps.run, caps.unit)} reached (${amount(spentRun, caps.unit)} spent${reserved > 0 ? `, ${amount(reserved, caps.unit)} in flight` : ''})` };
    }
    const day = this.daySpent();
    if (day + reserved + worst > caps.day) {
      return { ok: false, reason: `daily cap ${amount(caps.day, caps.unit)} reached (${amount(day, caps.unit)} spent today)` };
    }
    this.reserved.set(request, worst);
    return { ok: true };
  }

  private worstPrice(): Price | null {
    const base = this.o.caps.price;
    const fb = this.o.fallbackPrice;
    if (!base) return null;
    return fb ? { input: Math.max(base.input, fb.input), output: Math.max(base.output, fb.output), cacheRead: Math.max(base.cacheRead, fb.cacheRead), cacheWrite: Math.max(base.cacheWrite, fb.cacheWrite) } : base;
  }

  afterCall(usage: ChatResponse['usage'], _model: string, request: ChatRequest): void {
    this.reserved.delete(request);
    this.requests += 1;
    const tokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    const price = usage.fallback ? this.worstPrice() : this.o.caps.price;
    const usd = price ? costOf(usage, price) : 0;
    this.runUsd += usd;
    this.runTokens += tokens;
    recordSpend(this.o.providerId, { usd, tokens }, this.ledger);
  }

  release(request: ChatRequest): void {
    this.reserved.delete(request);
  }

  /** Numbers for the report: this run, today, and the caps. `costUsd` is null when the price is unknown. */
  summary(): { unit: 'usd' | 'tokens'; run: { usd: number; tokens: number }; today: { spent: number; cap: number }; costUsd: number | null; tokens: number; requests: number } {
    return { unit: this.unit(), run: this.runSpend(), today: { spent: this.daySpent(), cap: this.o.caps.day }, costUsd: this.o.caps.price ? this.runUsd : null, tokens: this.runTokens, requests: this.requests };
  }
}
