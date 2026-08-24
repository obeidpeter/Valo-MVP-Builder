import {
  isValidId,
  validateSources,
  type DomainIssue,
  type SourceDocument,
  type ValidatedSourceSet,
} from "./domain";

export const NEXT_CAPABILITY_MAX_ITEMS = 500;
export const NEXT_CAPABILITY_MAX_TEXT_CHARS = 20_000;

export interface NextCapabilitySafetyEnvelope {
  readonly currentLevel: 0;
  readonly targetCeilingLevel: 1 | 2;
  readonly deterministicProjectionOnly: true;
  readonly proposalOnly: true;
  readonly requiresNamedHumanApproval: true;
  readonly authoritativeStateChange: false;
  readonly externalAction: "none";
  readonly submissionAuthorized: false;
  readonly legalDecisionAuthorized: false;
  readonly commercialDecisionAuthorized: false;
}

const NEXT_CAPABILITY_SAFETY_LEVEL_1: NextCapabilitySafetyEnvelope =
  Object.freeze({
    currentLevel: 0,
    targetCeilingLevel: 1,
    deterministicProjectionOnly: true,
    proposalOnly: true,
    requiresNamedHumanApproval: true,
    authoritativeStateChange: false,
    externalAction: "none",
    submissionAuthorized: false,
    legalDecisionAuthorized: false,
    commercialDecisionAuthorized: false,
  });
const NEXT_CAPABILITY_SAFETY_LEVEL_2: NextCapabilitySafetyEnvelope =
  Object.freeze({
    ...NEXT_CAPABILITY_SAFETY_LEVEL_1,
    targetCeilingLevel: 2,
  });

export function nextCapabilitySafety(
  targetCeilingLevel: 1 | 2 = 1,
): NextCapabilitySafetyEnvelope {
  return targetCeilingLevel === 2
    ? NEXT_CAPABILITY_SAFETY_LEVEL_2
    : NEXT_CAPABILITY_SAFETY_LEVEL_1;
}

export function validateNextCapabilityCollection(
  items: readonly unknown[],
  path: string,
  label: string,
  maximum = NEXT_CAPABILITY_MAX_ITEMS,
): DomainIssue[] {
  return items.length <= maximum
    ? []
    : [
        {
          code: "capability_item_limit_exceeded",
          severity: "blocker",
          path,
          message: `${label} exceeds the deterministic limit of ${maximum} items.`,
        },
      ];
}

export function boundedNextCapabilityRecordKeys(
  record: Readonly<Record<string, unknown>> | undefined,
  path: string,
  label: string,
  maximum = NEXT_CAPABILITY_MAX_ITEMS,
): {
  readonly keys: readonly string[];
  readonly issues: readonly DomainIssue[];
} {
  const keys: string[] = [];
  const issues: DomainIssue[] = [];
  let inspected = 0;
  let overflow = false;
  if (record) {
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      if (inspected >= maximum) {
        overflow = true;
        break;
      }
      const index = inspected;
      inspected += 1;
      if (!isValidId(key)) {
        issues.push({
          code: "capability_record_key_invalid",
          severity: "blocker",
          path: `${path}[${index}]`,
          message: `${label} keys must be bounded domain IDs.`,
        });
        continue;
      }
      keys.push(key);
    }
  }
  if (overflow) {
    issues.push({
      code: "capability_item_limit_exceeded",
      severity: "blocker",
      path,
      message: `${label} exceeds the deterministic limit of ${maximum} items.`,
    });
  }
  return {
    keys,
    issues,
  };
}

/**
 * Bounds source validation before hashing or inspecting source content. The
 * returned issue list retains the overflow blocker, so callers may surface a
 * deterministic partial projection but can never mark it ready.
 */
export function validateNextCapabilitySources(
  sources: readonly SourceDocument[],
  label = "Source documents",
  options: { readonly maximumContentChars?: number } = {},
): { readonly sourceSet: ValidatedSourceSet; readonly issues: DomainIssue[] } {
  const maximumContentChars =
    options.maximumContentChars ?? NEXT_CAPABILITY_MAX_TEXT_CHARS;
  const bounded = sources.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues = validateNextCapabilityCollection(sources, "sources", label);
  bounded.forEach((source, index) => {
    issues.push(
      ...validateNextCapabilityText(
        source.title,
        `sources[${index}].title`,
        "Source title",
      ),
      ...validateNextCapabilityText(
        source.origin,
        `sources[${index}].origin`,
        "Source origin",
      ),
      ...validateNextCapabilityText(
        source.content,
        `sources[${index}].content`,
        "Source content",
        { maximum: maximumContentChars },
      ),
    );
  });
  const safeToInspect = bounded.filter(
    (source) =>
      source.title.length <= NEXT_CAPABILITY_MAX_TEXT_CHARS &&
      source.origin.length <= NEXT_CAPABILITY_MAX_TEXT_CHARS &&
      source.content.length > 0 &&
      source.content.length <= maximumContentChars,
  );
  const sourceSet = validateSources(safeToInspect);
  issues.push(...sourceSet.issues);
  return { sourceSet, issues };
}

export function validateNextCapabilityText(
  value: string,
  path: string,
  label: string,
  options: { readonly required?: boolean; readonly maximum?: number } = {},
): DomainIssue[] {
  const required = options.required ?? true;
  const maximum = options.maximum ?? NEXT_CAPABILITY_MAX_TEXT_CHARS;
  if (value.length > maximum) {
    return [
      {
        code: "capability_text_limit_exceeded",
        severity: "blocker",
        path,
        message: `${label} exceeds the deterministic limit of ${maximum} characters.`,
      },
    ];
  }
  if (required && !value.trim()) {
    return [
      {
        code: "capability_text_required",
        severity: "blocker",
        path,
        message: `${label} is required.`,
      },
    ];
  }
  return [];
}
