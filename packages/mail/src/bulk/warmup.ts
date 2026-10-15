import { BULK_CONFIG } from './config';

// Warm-up math (brief §7.4). Day n's cap is startCap × factor^(n ÷ stepDays), never above the
// domain's target. A healthy day advances the ramp; a breach day holds it, and stepBackAfter
// breach days in a row step it back one step.

type Ramp = (typeof BULK_CONFIG)['warmup'];

export function warmupCap(day: number, target: number, ramp: Ramp = BULK_CONFIG.warmup): number {
  const steps = Math.floor(Math.max(0, day) / ramp.stepDays);
  const cap = ramp.startCap * ramp.factor ** Math.min(steps, 40);
  return Math.min(target, Math.round(cap));
}

export type WarmupState = { warmupDay: number; warmupBreaches: number; target: number };

export type WarmupStep = WarmupState & {
  cap: number;
  /** True once the cap has reached the target: the domain moves from warming to active. */
  complete: boolean;
  change: 'advanced' | 'held' | 'stepped_back';
};

export function nextWarmup(
  state: WarmupState,
  breached: boolean,
  ramp: Ramp = BULK_CONFIG.warmup,
): WarmupStep {
  let { warmupDay, warmupBreaches } = state;
  let change: WarmupStep['change'];
  if (!breached) {
    warmupDay += 1;
    warmupBreaches = 0;
    change = 'advanced';
  } else {
    warmupBreaches += 1;
    if (warmupBreaches >= ramp.stepBackAfter) {
      warmupDay = Math.max(0, warmupDay - ramp.stepDays);
      warmupBreaches = 0;
      change = 'stepped_back';
    } else change = 'held';
  }
  const cap = warmupCap(warmupDay, state.target, ramp);
  return {
    warmupDay,
    warmupBreaches,
    target: state.target,
    cap,
    complete: cap >= state.target,
    change,
  };
}

/** How many of `wanted` sends fit under today's cap, given how many already went today. */
export function underCap(cap: number, sentToday: number, wanted: number): number {
  return Math.max(0, Math.min(wanted, cap - sentToday));
}
