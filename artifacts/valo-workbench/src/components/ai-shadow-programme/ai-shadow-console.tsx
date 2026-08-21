import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BotOff,
  CheckCircle2,
  FlaskConical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_SHADOW_CAPABILITIES,
  AI_SHADOW_COHORTS,
  type AiShadowCapability,
  type AiShadowCohort,
  type AiShadowPlanSnapshot,
  type AiShadowSnapshot,
} from "./ai-shadow-contract";

const VERSION_FIELDS = [
  "applicationReleaseSha256",
  "modelSnapshotSha256",
  "modelConfigurationSha256",
  "promptSha256",
  "schemaSha256",
  "retrievalPolicySha256",
  "corpusManifestSha256",
  "governanceDecisionSha256",
  "expectedCaseManifestSha256",
] as const;

type VersionField = (typeof VERSION_FIELDS)[number];

export interface AiShadowPlanCreateDraft {
  capabilityId: AiShadowCapability;
  title: string;
  purpose: string;
  versions: Record<VersionField, string>;
  cohorts: AiShadowCohort[];
  expectedCaseCount: number;
  expiresAt: string;
  idempotencyKey: string;
}

export interface AiShadowObservationCreateDraft {
  caseId: string;
  cohort: AiShadowCohort;
  disposition: "completed" | "abstained" | "safe_failure";
  expectedDisposition: "completed" | "abstained" | "safe_failure";
  passed: boolean;
  outputSha256: string | null;
  fatalMissCount: number;
  unsupportedMaterialClaimCount: number;
  tenantLeakDetected: boolean;
  injectionContained: boolean;
  citationCorrectCount: number;
  citationEvaluatedCount: number;
  latencyMs: number;
  costMinor: number;
  reviewerNoteCode:
    | "fixture_verified"
    | "fixture_discrepancy"
    | "safe_failure_verified"
    | "requires_adjudication";
  observedAt: string;
  idempotencyKey: string;
}

function PlanCard({
  item,
  pending,
  onClose,
}: {
  item: AiShadowPlanSnapshot;
  pending: boolean;
  onClose: (item: AiShadowPlanSnapshot, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const active = item.plan.status === "active";
  const submitClosure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCloseError(null);
    try {
      await onClose(item, reason);
      setReason("");
    } catch {
      setCloseError(
        "Plan closure was not confirmed. Review the current register before retrying; the entered reason has been kept.",
      );
    }
  };
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{item.plan.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.plan.capabilityId.replaceAll("_", " ")} · created by{" "}
              {item.plan.createdByName}
            </p>
          </div>
          <Badge variant={active ? "outline" : "secondary"}>
            {item.plan.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{item.plan.purpose}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Cases</dt>
            <dd className="font-medium">
              {item.observationCount}/{item.plan.expectedCaseCount}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cohorts</dt>
            <dd className="font-medium">
              {item.coveredCohorts.length}/{AI_SHADOW_COHORTS.length}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recommendation</dt>
            <dd className="font-medium">
              {item.plan.evaluationRecommendation.replaceAll("_", " ")}
            </dd>
          </div>
        </dl>
        {item.blockers.length ? (
          <div className="rounded-lg border border-warning bg-warning/10 p-3 text-sm text-foreground">
            <p className="font-medium">Current blockers</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {item.blockers.map((blocker) => (
                <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {active ? (
          <form
            className="space-y-2 border-t pt-4"
            onSubmit={(event) => void submitClosure(event)}
          >
            <Label htmlFor={`close-${item.plan.id}`}>
              Independent closure reason
            </Label>
            <Textarea
              id={`close-${item.plan.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={1}
              maxLength={1000}
              required
            />
            {closeError ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {closeError}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={pending}
            >
              Close as independent reviewer
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AiShadowProgrammeConsole({
  snapshot,
  canManage,
  pending,
  onCreatePlan,
  onRecordObservation,
  onClosePlan,
}: {
  snapshot: AiShadowSnapshot;
  canManage: boolean;
  pending: boolean;
  onCreatePlan: (draft: AiShadowPlanCreateDraft) => Promise<void>;
  onRecordObservation: (
    planId: string,
    draft: AiShadowObservationCreateDraft,
  ) => Promise<void>;
  onClosePlan: (item: AiShadowPlanSnapshot, reason: string) => Promise<void>;
}) {
  const activePlans = snapshot.plans.filter(
    ({ plan }) => plan.status === "active",
  );
  const capacityReached = snapshot.plans.length >= 25;
  const [capability, setCapability] = useState<AiShadowCapability>(
    "extract_requirements",
  );
  const [versions, setVersions] = useState<Record<VersionField, string>>(
    Object.fromEntries(VERSION_FIELDS.map((field) => [field, ""])) as Record<
      VersionField,
      string
    >,
  );
  const [observationPlanId, setObservationPlanId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const selectedPlan = useMemo(
    () =>
      activePlans.find(({ plan }) => plan.id === observationPlanId) ??
      activePlans[0],
    [activePlans, observationPlanId],
  );

  const submitPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (capacityReached) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setFormError(null);
    try {
      await onCreatePlan({
        capabilityId: capability,
        title: String(data.get("title") ?? ""),
        purpose: String(data.get("purpose") ?? ""),
        versions,
        cohorts: [...AI_SHADOW_COHORTS],
        expectedCaseCount: Number(data.get("expectedCaseCount")),
        expiresAt: new Date(String(data.get("expiresAt"))).toISOString(),
        idempotencyKey: String(data.get("idempotencyKey") ?? ""),
      });
      form.reset();
    } catch {
      setFormError(
        "Shadow plan registration was not confirmed. Review the current register before retrying; the entered evidence has been kept.",
      );
    }
  };

  const submitObservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPlan) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const disposition = String(
      data.get("disposition"),
    ) as AiShadowObservationCreateDraft["disposition"];
    const expectedDisposition = String(
      data.get("expectedDisposition"),
    ) as AiShadowObservationCreateDraft["expectedDisposition"];
    const outputSha256 = String(data.get("outputSha256") ?? "").trim();
    setFormError(null);
    try {
      await onRecordObservation(selectedPlan.plan.id, {
        caseId: String(data.get("caseId") ?? ""),
        cohort: String(data.get("cohort")) as AiShadowCohort,
        disposition,
        expectedDisposition,
        passed: data.get("passed") === "on",
        outputSha256: outputSha256 || null,
        fatalMissCount: Number(data.get("fatalMissCount")),
        unsupportedMaterialClaimCount: Number(
          data.get("unsupportedMaterialClaimCount"),
        ),
        tenantLeakDetected: data.get("tenantLeakDetected") === "on",
        injectionContained: data.get("injectionContained") === "on",
        citationCorrectCount: Number(data.get("citationCorrectCount")),
        citationEvaluatedCount: Number(data.get("citationEvaluatedCount")),
        latencyMs: Number(data.get("latencyMs")),
        costMinor: Number(data.get("costMinor")),
        reviewerNoteCode: String(
          data.get("reviewerNoteCode"),
        ) as AiShadowObservationCreateDraft["reviewerNoteCode"],
        observedAt: new Date(String(data.get("observedAt"))).toISOString(),
        idempotencyKey: String(data.get("idempotencyKey") ?? ""),
      });
      form.reset();
    } catch {
      setFormError(
        "Shadow observation was not confirmed. Review the current register before retrying; the entered evidence has been kept.",
      );
    }
  };

  return (
    <main className="space-y-6 p-5 sm:p-8">
      <section className="rounded-2xl border bg-card p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <FlaskConical aria-hidden="true" className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              Controlled evaluation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              AI Shadow Programme
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
              Register no-output shadow plans and hash-only reviewer
              observations. Nothing here calls a model, persists raw output,
              reaches a customer, or activates production AI.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-success">
          <BotOff aria-hidden="true" className="size-5 shrink-0" />
          Provider disclosure and production activation remain hard-disabled.
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning bg-warning/10 p-3 text-sm text-foreground">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0"
          />
          <span>
            This pilot retains at most 25 lifetime plans per organisation and
            has no in-app archive. Stop before capacity and use a reviewed
            storage/retention migration; never delete tenant audit events to
            make room.
          </span>
        </div>
      </section>

      {canManage ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {formError ? (
            <p
              role="alert"
              className="text-sm font-medium text-destructive xl:col-span-2"
            >
              {formError}
            </p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Create a version-bound plan</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => void submitPlan(event)}
              >
                <div className="grid gap-2">
                  <Label htmlFor="shadow-title">Title</Label>
                  <Input
                    id="shadow-title"
                    name="title"
                    maxLength={256}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shadow-purpose">Purpose</Label>
                  <Textarea
                    id="shadow-purpose"
                    name="purpose"
                    maxLength={1000}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shadow-capability">Capability</Label>
                  <select
                    id="shadow-capability"
                    className="min-h-11 rounded-md border bg-background px-3"
                    value={capability}
                    onChange={(event) =>
                      setCapability(event.target.value as AiShadowCapability)
                    }
                  >
                    {AI_SHADOW_CAPABILITIES.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {VERSION_FIELDS.map((field) => (
                    <div className="grid gap-2" key={field}>
                      <Label htmlFor={`shadow-${field}`}>
                        {field.replaceAll("Sha256", " SHA-256")}
                      </Label>
                      <Input
                        id={`shadow-${field}`}
                        value={versions[field]}
                        onChange={(event) =>
                          setVersions((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        pattern="[a-f0-9]{64}"
                        maxLength={64}
                        required
                      />
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="shadow-cases">Expected cases</Label>
                    <Input
                      id="shadow-cases"
                      name="expectedCaseCount"
                      type="number"
                      min={25}
                      max={500}
                      defaultValue={25}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shadow-expires">Expires</Label>
                    <Input
                      id="shadow-expires"
                      name="expiresAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shadow-plan-key">Idempotency key</Label>
                  <Input
                    id="shadow-plan-key"
                    name="idempotencyKey"
                    minLength={16}
                    maxLength={128}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={pending || capacityReached}
                >
                  {capacityReached
                    ? "Pilot plan register is full"
                    : "Register shadow plan"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record a hash-only observation</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedPlan ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => void submitObservation(event)}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="shadow-plan">Active plan</Label>
                    <select
                      id="shadow-plan"
                      className="min-h-11 rounded-md border bg-background px-3"
                      value={selectedPlan.plan.id}
                      onChange={(event) =>
                        setObservationPlanId(event.target.value)
                      }
                    >
                      {activePlans.map(({ plan }) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="shadow-case">Case ID</Label>
                      <Input
                        id="shadow-case"
                        name="caseId"
                        maxLength={128}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="shadow-cohort">Cohort</Label>
                      <select
                        id="shadow-cohort"
                        name="cohort"
                        className="min-h-11 rounded-md border bg-background px-3"
                      >
                        {AI_SHADOW_COHORTS.map((value) => (
                          <option key={value} value={value}>
                            {value.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {["disposition", "expectedDisposition"].map((name) => (
                      <div className="grid gap-2" key={name}>
                        <Label htmlFor={`shadow-${name}`}>
                          {name.replace(/([A-Z])/g, " $1")}
                        </Label>
                        <select
                          id={`shadow-${name}`}
                          name={name}
                          className="min-h-11 rounded-md border bg-background px-3"
                        >
                          {["completed", "abstained", "safe_failure"].map(
                            (value) => (
                              <option key={value} value={value}>
                                {value.replaceAll("_", " ")}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="shadow-output-hash">
                        Output SHA-256 (optional)
                      </Label>
                      <Input
                        id="shadow-output-hash"
                        name="outputSha256"
                        pattern="[a-f0-9]{64}"
                        maxLength={64}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="shadow-observed">Observed at</Label>
                      <Input
                        id="shadow-observed"
                        name="observedAt"
                        type="datetime-local"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      ["fatalMissCount", "Fatal misses"],
                      ["unsupportedMaterialClaimCount", "Unsupported claims"],
                      ["citationCorrectCount", "Correct citations"],
                      ["citationEvaluatedCount", "Citations evaluated"],
                      ["latencyMs", "Latency ms"],
                      ["costMinor", "Cost minor"],
                    ].map(([name, label]) => (
                      <div className="grid gap-2" key={name}>
                        <Label htmlFor={`shadow-${name}`}>{label}</Label>
                        <Input
                          id={`shadow-${name}`}
                          name={name}
                          type="number"
                          min={0}
                          defaultValue={0}
                          required
                        />
                      </div>
                    ))}
                  </div>
                  <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                    <legend className="px-1 text-sm font-medium">
                      Safety observations
                    </legend>
                    {[
                      ["passed", "Case passed"],
                      ["injectionContained", "Injection contained"],
                      ["tenantLeakDetected", "Tenant leak detected"],
                    ].map(([name, label]) => (
                      <label
                        key={name}
                        className="flex min-h-11 items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name={name}
                          defaultChecked={name !== "tenantLeakDetected"}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <div className="grid gap-2">
                    <Label htmlFor="shadow-reviewer-note">
                      Controlled reviewer note
                    </Label>
                    <select
                      id="shadow-reviewer-note"
                      name="reviewerNoteCode"
                      className="min-h-11 rounded-md border bg-background px-3"
                    >
                      {[
                        "fixture_verified",
                        "fixture_discrepancy",
                        "safe_failure_verified",
                        "requires_adjudication",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Free text and tender content are not accepted by this
                      register.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shadow-observation-key">
                      Idempotency key
                    </Label>
                    <Input
                      id="shadow-observation-key"
                      name="idempotencyKey"
                      minLength={16}
                      maxLength={128}
                      required
                    />
                  </div>
                  <Button type="submit" className="min-h-11" disabled={pending}>
                    Record observation
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Create an active plan before recording observations.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <section aria-labelledby="shadow-plans-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="shadow-plans-heading" className="text-xl font-semibold">
            Registered plans
          </h2>
          <span className="text-sm text-muted-foreground">
            {snapshot.plans.length} bounded plan
            {snapshot.plans.length === 1 ? "" : "s"}
          </span>
        </div>
        {snapshot.plans.length ? (
          snapshot.plans.map((item) => (
            <PlanCard
              key={item.plan.id}
              item={item}
              pending={pending}
              onClose={onClosePlan}
            />
          ))
        ) : (
          <Card>
            <CardContent className="flex items-start gap-3 py-6">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-5 text-muted-foreground"
              />
              <div>
                <p className="font-medium">
                  No shadow evidence has been inferred
                </p>
                <p className="text-sm text-muted-foreground">
                  A named evaluator must register an exact version-bound plan.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 aria-hidden="true" className="size-4" />
        Generated {new Date(snapshot.generatedAt).toLocaleString()}
      </div>
    </main>
  );
}
