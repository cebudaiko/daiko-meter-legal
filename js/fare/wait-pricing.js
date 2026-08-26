export function validateWaitPricing(value) {
  const errors = [];
  if (!value || value.version !== 1 || value.mode !== 'staged' || !Array.isArray(value.stages)) {
    return { ok: false, pricing: null, errors: ['invalid_shape'] };
  }
  if (value.stages.length < 1 || value.stages.length > 10) errors.push('invalid_stage_count');
  let startMinutes = 0;
  const stages = value.stages.map((stage, index) => {
    const final = index === value.stages.length - 1;
    const endMinutes = stage?.endMinutes === null ? null : Number(stage?.endMinutes);
    const intervalMinutes = Number(stage?.intervalMinutes);
    const amountYen = Number(stage?.amountYen);
    if (final ? endMinutes !== null : !Number.isInteger(endMinutes) || endMinutes <= startMinutes) errors.push(`endMinutes:${index}`);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) errors.push(`intervalMinutes:${index}`);
    if (!Number.isInteger(amountYen) || amountYen < 0) errors.push(`amountYen:${index}`);
    if (endMinutes !== null && Number.isInteger(intervalMinutes) && (endMinutes - startMinutes) % intervalMinutes !== 0) {
      errors.push(`indivisible:${index}`);
    }
    if (endMinutes !== null) startMinutes = endMinutes;
    return { endMinutes, intervalMinutes, amountYen };
  });
  return errors.length
    ? { ok: false, pricing: null, errors }
    : { ok: true, pricing: { version: 1, mode: 'staged', stages }, errors: [] };
}

export function calcStagedWaitFee(waitSeconds, pricing) {
  const seconds = Math.max(0, waitSeconds);
  let startSec = 0;
  let fee = 0;

  for (const stage of pricing.stages) {
    const endSec = stage.endMinutes === null ? Infinity : stage.endMinutes * 60;
    const stageElapsedSec = Math.max(0, Math.min(seconds, endSec) - startSec);
    fee += Math.floor(stageElapsedSec / (stage.intervalMinutes * 60)) * stage.amountYen;
    startSec = endSec;
  }

  return fee;
}

export function getNextStagedWaitIncrease(waitSeconds, pricing) {
  const seconds = Math.max(0, waitSeconds);
  const currentFee = calcStagedWaitFee(seconds, pricing);
  let stageStartSec = 0;

  for (const stage of pricing.stages) {
    const intervalSec = stage.intervalMinutes * 60;
    const stageEndSec = stage.endMinutes === null ? Infinity : stage.endMinutes * 60;

    if (stage.amountYen > 0) {
      const completedIntervals = Math.max(0, Math.floor((seconds - stageStartSec) / intervalSec));
      const nextSec = stageStartSec + (completedIntervals + 1) * intervalSec;
      if (nextSec <= stageEndSec) {
        return {
          currentFee,
          nextFee: calcStagedWaitFee(nextSec, pricing),
          startSec: nextSec - intervalSec,
          nextSec,
        };
      }
    }

    stageStartSec = stageEndSec;
  }

  return null;
}
