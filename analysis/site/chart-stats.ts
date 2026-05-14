const T_CRITICAL_95: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
};

export interface MeanInterval {
  n: number;
  mean: number;
  lower: number;
  upper: number;
  ciEstimated: boolean;
  ciLabel: string;
}

export interface ProportionInterval {
  n: number;
  successes: number;
  rate: number;
  lower: number;
  upper: number;
  ciLabel: string;
}

export interface DifferenceInterval {
  nA: number;
  nB: number;
  difference: number;
  lower: number;
  upper: number;
  ciEstimated: boolean;
  ciLabel: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tCritical95(degreesOfFreedom: number): number {
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 1) {
    return T_CRITICAL_95[1];
  }
  if (degreesOfFreedom <= 30) {
    return T_CRITICAL_95[Math.ceil(degreesOfFreedom)] ?? T_CRITICAL_95[30];
  }
  if (degreesOfFreedom <= 40) return 2.021;
  if (degreesOfFreedom <= 60) return 2;
  if (degreesOfFreedom <= 120) return 1.98;
  return 1.96;
}

function standardDeviation(values: number[], meanValue: number): number {
  if (values.length < 2) {
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function meanInterval(values: number[], bounds: { min: number; max: number }): MeanInterval | null {
  const meanValue = mean(values);
  if (meanValue === null) {
    return null;
  }

  if (values.length < 2) {
    const point = round(clamp(meanValue, bounds.min, bounds.max), 3);
    return {
      n: values.length,
      mean: point,
      lower: point,
      upper: point,
      ciEstimated: false,
      ciLabel: 'n < 2; 95% CI not estimated',
    };
  }

  const sd = standardDeviation(values, meanValue);
  const margin = tCritical95(values.length - 1) * (sd / Math.sqrt(values.length));
  const lower = round(clamp(meanValue - margin, bounds.min, bounds.max), 3);
  const upper = round(clamp(meanValue + margin, bounds.min, bounds.max), 3);

  return {
    n: values.length,
    mean: round(clamp(meanValue, bounds.min, bounds.max), 3),
    lower,
    upper,
    ciEstimated: true,
    ciLabel: `95% CI ${lower.toFixed(2)}–${upper.toFixed(2)}`,
  };
}

export function wilsonInterval(successes: number, total: number): ProportionInterval | null {
  if (total <= 0) {
    return null;
  }

  const z = 1.96;
  const phat = successes / total;
  const z2 = z ** 2;
  const denominator = 1 + z2 / total;
  const center = (phat + z2 / (2 * total)) / denominator;
  const halfWidth = (z / denominator) * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  const lower = round(clamp(center - halfWidth, 0, 1), 4);
  const upper = round(clamp(center + halfWidth, 0, 1), 4);

  return {
    n: total,
    successes,
    rate: round(phat, 4),
    lower,
    upper,
    ciLabel: `Wilson 95% CI ${(lower * 100).toFixed(0)}–${(upper * 100).toFixed(0)}%`,
  };
}

export function meanDifferenceInterval(
  valuesA: number[],
  valuesB: number[],
  bounds: { min: number; max: number },
): DifferenceInterval | null {
  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  if (meanA === null || meanB === null) {
    return null;
  }

  const difference = meanA - meanB;
  if (valuesA.length < 2 || valuesB.length < 2) {
    const point = round(clamp(difference, bounds.min, bounds.max), 3);
    return {
      nA: valuesA.length,
      nB: valuesB.length,
      difference: point,
      lower: point,
      upper: point,
      ciEstimated: false,
      ciLabel: 'one side has n < 2; 95% CI not estimated',
    };
  }

  const sdA = standardDeviation(valuesA, meanA);
  const sdB = standardDeviation(valuesB, meanB);
  const varianceA = (sdA ** 2) / valuesA.length;
  const varianceB = (sdB ** 2) / valuesB.length;
  const standardError = Math.sqrt(varianceA + varianceB);

  if (standardError === 0) {
    const point = round(clamp(difference, bounds.min, bounds.max), 3);
    return {
      nA: valuesA.length,
      nB: valuesB.length,
      difference: point,
      lower: point,
      upper: point,
      ciEstimated: true,
      ciLabel: `95% CI ${point.toFixed(2)}–${point.toFixed(2)}`,
    };
  }

  const denominator = (varianceA ** 2) / (valuesA.length - 1) + (varianceB ** 2) / (valuesB.length - 1);
  const degreesOfFreedom = denominator === 0
    ? Math.min(valuesA.length - 1, valuesB.length - 1)
    : ((varianceA + varianceB) ** 2) / denominator;
  const margin = tCritical95(degreesOfFreedom) * standardError;
  const lower = round(clamp(difference - margin, bounds.min, bounds.max), 3);
  const upper = round(clamp(difference + margin, bounds.min, bounds.max), 3);

  return {
    nA: valuesA.length,
    nB: valuesB.length,
    difference: round(clamp(difference, bounds.min, bounds.max), 3),
    lower,
    upper,
    ciEstimated: true,
    ciLabel: `95% CI ${lower.toFixed(2)}–${upper.toFixed(2)}`,
  };
}
