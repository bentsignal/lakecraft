/** A pure, deterministic day/night model. Phase 0 is midnight and 0.5 is noon. */

export type TimeOfDayLabel = "night" | "dawn" | "day" | "dusk";

export interface DayNightConfig {
  /** Real milliseconds in one complete in-game day. */
  cycleLengthMs: number;
  /** Server timestamp used as the phase origin. */
  epochMs: number;
  /** Normalized phase at epochMs. Values outside [0, 1) wrap. */
  epochPhase: number;
}

export interface DayNightState {
  phase: number;
  label: TimeOfDayLabel;
  sunAngle: number;
  moonAngle: number;
  sunIntensity: number;
  moonIntensity: number;
  starIntensity: number;
  ambientIntensity: number;
  directionalIntensity: number;
  skyR: number;
  skyG: number;
  skyB: number;
  fogR: number;
  fogG: number;
  fogB: number;
  ambientR: number;
  ambientG: number;
  ambientB: number;
  directionalR: number;
  directionalG: number;
  directionalB: number;
}

export const DEFAULT_DAY_NIGHT_CONFIG: Readonly<DayNightConfig> = Object.freeze({
  cycleLengthMs: 20 * 60 * 1_000,
  epochMs: 0,
  epochPhase: 0,
});

export const MORNING_PHASE = 0.25;

const TAU = Math.PI * 2;

// RGB keyframes are module constants so sampling does not allocate temporary colors.
const SKY_PHASES = [0, 0.18, 0.23, 0.29, 0.38, 0.62, 0.71, 0.77, 0.82, 1] as const;
const SKY_RED = [0.018, 0.035, 0.3, 0.95, 0.35, 0.35, 0.95, 0.24, 0.035, 0.018] as const;
const SKY_GREEN = [0.026, 0.045, 0.13, 0.5, 0.67, 0.67, 0.31, 0.09, 0.045, 0.026] as const;
const SKY_BLUE = [0.075, 0.12, 0.22, 0.27, 0.98, 0.98, 0.25, 0.19, 0.12, 0.075] as const;

function positiveModulo(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function phaseLabel(phase: number): TimeOfDayLabel {
  if (phase >= 0.18 && phase < 0.3) return "dawn";
  if (phase >= 0.3 && phase < 0.7) return "day";
  if (phase >= 0.7 && phase < 0.82) return "dusk";
  return "night";
}

function skyInterval(phase: number): number {
  // Ten fixed keyframes make this small linear search cheaper than allocating helpers.
  for (let index = 0; index < SKY_PHASES.length - 1; index += 1) {
    if (phase <= SKY_PHASES[index + 1]) return index;
  }
  return SKY_PHASES.length - 2;
}

function interpolateChannel(
  values: readonly number[],
  index: number,
  amount: number,
): number {
  return values[index] + (values[index + 1] - values[index]) * amount;
}

export function phaseAtTime(
  serverTimeMs: number,
  config: Readonly<DayNightConfig> = DEFAULT_DAY_NIGHT_CONFIG,
): number {
  const cycleLengthMs = Number.isFinite(config.cycleLengthMs) && config.cycleLengthMs
    || DEFAULT_DAY_NIGHT_CONFIG.cycleLengthMs;
  const epochMs = Number.isFinite(config.epochMs) ? config.epochMs : 0;
  const epochPhase = Number.isFinite(config.epochPhase) ? config.epochPhase : 0;
  return positiveModulo(epochPhase + (cycleLengthMs > 0 ? (serverTimeMs - epochMs) / cycleLengthMs : 0), 1);
}

/**
 * Returns milliseconds until the next sunrise phase. At exact sunrise it returns
 * zero. Supplying server time keeps every client synchronized to the same result.
 */
export function timeToMorningMs(
  serverTimeMs: number,
  config: Readonly<DayNightConfig> = DEFAULT_DAY_NIGHT_CONFIG,
  morningPhase = MORNING_PHASE,
): number {
  const cycleLengthMs = Math.abs(Number.isFinite(config.cycleLengthMs) ? config.cycleLengthMs : 0)
    || DEFAULT_DAY_NIGHT_CONFIG.cycleLengthMs;
  const phase = phaseAtTime(serverTimeMs, config);
  const target = positiveModulo(Number.isFinite(morningPhase) ? morningPhase : MORNING_PHASE, 1);
  let distance = positiveModulo(target - phase, 1);
  if (distance < 1e-12 || 1 - distance < 1e-12) distance = 0;
  return distance * cycleLengthMs;
}

export function createDayNightState(): DayNightState {
  return {
    phase: 0,
    label: "night",
    sunAngle: -Math.PI / 2,
    moonAngle: Math.PI / 2,
    sunIntensity: 0,
    moonIntensity: 1,
    starIntensity: 1,
    ambientIntensity: 0.12,
    directionalIntensity: 0.2,
    skyR: SKY_RED[0],
    skyG: SKY_GREEN[0],
    skyB: SKY_BLUE[0],
    fogR: SKY_RED[0],
    fogG: SKY_GREEN[0],
    fogB: SKY_BLUE[0],
    ambientR: 0.18,
    ambientG: 0.22,
    ambientB: 0.34,
    directionalR: 0.48,
    directionalG: 0.56,
    directionalB: 0.78,
  };
}

/**
 * Samples all lighting values. Pass a reused `out` object in the render loop to
 * make this function allocation-free after initialization.
 */
export function sampleDayNight(
  serverTimeMs: number,
  config: Readonly<DayNightConfig> = DEFAULT_DAY_NIGHT_CONFIG,
  out: DayNightState = createDayNightState(),
): DayNightState {
  const phase = phaseAtTime(serverTimeMs, config);
  const sunAngle = phase * TAU - Math.PI / 2;
  const solarElevation = Math.sin(sunAngle);
  const sunIntensity = smoothstep(-0.12, 0.22, solarElevation);
  const moonIntensity = smoothstep(-0.08, 0.28, -solarElevation) * (1 - sunIntensity * 0.7);
  const starIntensity = smoothstep(0.18, 0.72, 1 - sunIntensity);
  const interval = skyInterval(phase);
  const linearAmount = (phase - SKY_PHASES[interval])
    / (SKY_PHASES[interval + 1] - SKY_PHASES[interval]);
  const amount = linearAmount * linearAmount * (3 - 2 * linearAmount);
  const skyR = interpolateChannel(SKY_RED, interval, amount);
  const skyG = interpolateChannel(SKY_GREEN, interval, amount);
  const skyB = interpolateChannel(SKY_BLUE, interval, amount);
  const daylight = smoothstep(0.02, 0.9, sunIntensity);

  out.phase = phase;
  out.label = phaseLabel(phase);
  out.sunAngle = sunAngle;
  out.moonAngle = sunAngle + Math.PI;
  out.sunIntensity = sunIntensity;
  out.moonIntensity = moonIntensity;
  out.starIntensity = starIntensity;
  out.ambientIntensity = 0.12 + daylight * 0.58;
  out.directionalIntensity = 0.18 + sunIntensity * 0.82 + moonIntensity * 0.08;
  out.skyR = skyR;
  out.skyG = skyG;
  out.skyB = skyB;
  // Fog tracks the horizon but is slightly desaturated and brighter by day.
  out.fogR = skyR * 0.82 + daylight * 0.1;
  out.fogG = skyG * 0.82 + daylight * 0.1;
  out.fogB = skyB * 0.82 + daylight * 0.1;
  out.ambientR = 0.18 + daylight * 0.72;
  out.ambientG = 0.22 + daylight * 0.71;
  out.ambientB = 0.34 + daylight * 0.62;
  // Moonlight is cool; sunlight warms near the horizon.
  const horizonWarmth = (1 - Math.abs(solarElevation)) * sunIntensity;
  out.directionalR = 0.48 + sunIntensity * 0.52;
  out.directionalG = 0.56 + sunIntensity * (0.42 - horizonWarmth * 0.12);
  out.directionalB = 0.78 + sunIntensity * (0.2 - horizonWarmth * 0.28);
  return out;
}
