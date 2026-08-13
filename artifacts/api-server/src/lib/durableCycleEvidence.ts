export interface DurableCycleEvidenceInput {
  carriedIncomplete: boolean;
  invocationIncomplete: boolean;
  cycleComplete: boolean;
}

export interface DurableCycleEvidenceResult {
  fullCycleComplete: boolean;
  nextCycleIncomplete: boolean;
}

/**
 * Carry an incomplete observation until the current cursor cycle wraps. A
 * dirty wrap emits no completion evidence and clears the bit so only a wholly
 * new, clean cycle can produce the next full-cycle signal.
 */
export function advanceDurableCycleEvidence({
  carriedIncomplete,
  invocationIncomplete,
  cycleComplete,
}: DurableCycleEvidenceInput): DurableCycleEvidenceResult {
  const completedCycleWasIncomplete = carriedIncomplete || invocationIncomplete;
  return {
    fullCycleComplete: cycleComplete && !completedCycleWasIncomplete,
    nextCycleIncomplete: cycleComplete ? false : completedCycleWasIncomplete,
  };
}
