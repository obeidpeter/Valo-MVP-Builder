/**
 * Shared pass/fail checker for the proof-harness scripts.
 *
 * Each script instantiates its own checker; console output is byte-identical
 * to the previous per-script implementations.
 */
export interface ProofChecker {
  check(label: string, ok: boolean, detail?: string): boolean;
  section(title: string): void;
  passes(): number;
  failures(): number;
}

export function createChecker(): ProofChecker {
  let passes = 0;
  let failures = 0;
  return {
    check(label: string, ok: boolean, detail?: string): boolean {
      if (ok) {
        passes += 1;
        console.log(`  ✓ ${label}`);
      } else {
        failures += 1;
        console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      }
      return ok;
    },
    section(title: string): void {
      console.log(`\n=== ${title} ===`);
    },
    passes: () => passes,
    failures: () => failures,
  };
}
