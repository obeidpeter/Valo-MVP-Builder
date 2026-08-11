import { useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Handshake,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConsortiumMutation,
  ConsortiumParticipantOption,
  ConsortiumParty,
  ConsortiumQaItem,
  ConsortiumReasonCode,
  ConsortiumResponsibility,
  ConsortiumSnapshot,
} from "./partner-consortium-contract";

const QA_LABELS: Readonly<Record<ConsortiumQaItem["code"], string>> = {
  evidence_quality_review: "Evidence quality review",
  requirement_coverage_review: "Requirement coverage review",
  client_release_readiness: "Client release readiness",
  partner_cosign: "Partner co-sign",
};

const REASON_LABELS: Readonly<Record<ConsortiumReasonCode, string>> = {
  ownership_mismatch: "Ownership mismatch",
  scope_unclear: "Scope is unclear",
  deadline_unworkable: "Deadline is unworkable",
  quality_control_gap: "Quality-control gap",
  evidence_not_sufficient: "Evidence is not sufficient",
  offline_discussion_required: "Offline discussion required",
};

const REASONS = Object.keys(REASON_LABELS) as ConsortiumReasonCode[];

function short(value: string, start = 8, end = 6): string {
  return value.length <= start + end + 1
    ? value
    : `${value.slice(0, start)}…${value.slice(-end)}`;
}

function dateTime(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

function localIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function participantsFor(
  participants: readonly ConsortiumParticipantOption[],
  party: ConsortiumParty,
): readonly ConsortiumParticipantOption[] {
  return participants.filter((participant) => participant.party === party);
}

function participantName(
  participants: readonly ConsortiumParticipantOption[],
  userId: string,
  party: ConsortiumParty,
): string {
  return (
    participants.find(
      (participant) =>
        participant.party === party && participant.userId === userId,
    )?.name ?? "Named member details unavailable"
  );
}

export function ConsortiumRoomInitializer(props: {
  participants: readonly ConsortiumParticipantOption[];
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [clientCoordinatorUserId, setClientCoordinatorUserId] = useState("");
  const [partnerCoordinatorUserId, setPartnerCoordinatorUserId] = useState("");
  const [idempotencyKey] = useState(
    () => `consortium-room-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
  );
  const clientParticipants = participantsFor(props.participants, "client");
  const partnerParticipants = participantsFor(props.participants, "partner");
  const canInitialize =
    clientParticipants.length > 0 && partnerParticipants.length > 0;

  return (
    <form
      className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        props.onMutate({
          kind: "initialize",
          path: "",
          body: {
            idempotencyKey,
            clientCoordinatorUserId: clientCoordinatorUserId.trim(),
            partnerCoordinatorUserId: partnerCoordinatorUserId.trim(),
          },
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">
          Initialize the relationship room
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name one active direct member from each party. The server verifies the
          exact relationship and both memberships before creating anything.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Client coordinator
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={clientCoordinatorUserId}
            disabled={props.pending || clientParticipants.length === 0}
            onChange={(event) =>
              setClientCoordinatorUserId(event.currentTarget.value)
            }
          >
            <option value="">Select an active client member</option>
            {clientParticipants.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Partner coordinator
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={partnerCoordinatorUserId}
            disabled={props.pending || partnerParticipants.length === 0}
            onChange={(event) =>
              setPartnerCoordinatorUserId(event.currentTarget.value)
            }
          >
            <option value="">Select an active partner member</option>
            {partnerParticipants.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!canInitialize ? (
        <p className="text-sm text-amber-800" role="status">
          Initialization is unavailable until the server returns at least one
          current named direct member for each party.
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            props.pending ||
            !canInitialize ||
            !clientCoordinatorUserId ||
            !partnerCoordinatorUserId
          }
        >
          <Handshake className="mr-2 size-4" aria-hidden="true" />
          Initialize bounded room
        </Button>
      </div>
    </form>
  );
}

function AddResponsibilityForm(props: {
  participants: readonly ConsortiumParticipantOption[];
  version: number;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [workstreamLabel, setWorkstreamLabel] = useState("");
  const [responsibleParty, setResponsibleParty] =
    useState<ConsortiumParty>("partner");
  const [accountableParty, setAccountableParty] =
    useState<ConsortiumParty>("client");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const ownerOptions = participantsFor(props.participants, responsibleParty);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onMutate({
      kind: "responsibility",
      path: "responsibilities",
      body: {
        expectedVersion: props.version,
        workstreamLabel: workstreamLabel.trim(),
        responsibleParty,
        accountableParty,
        ownerUserId: ownerUserId.trim(),
        dueAt: localIso(dueAt),
      },
    });
  };

  return (
    <form
      className="grid gap-4 rounded-xl border bg-card p-5"
      onSubmit={submit}
    >
      <div>
        <h2 className="font-semibold">Add a responsibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every row needs a named owner and separate acceptance from both
          parties.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-medium xl:col-span-2">
          Workstream label
          <input
            required
            maxLength={160}
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={workstreamLabel}
            onChange={(event) => setWorkstreamLabel(event.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Responsible party
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={responsibleParty}
            onChange={(event) => {
              setResponsibleParty(event.currentTarget.value as ConsortiumParty);
              setOwnerUserId("");
            }}
          >
            <option value="partner">Partner</option>
            <option value="client">Client</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Accountable party
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={accountableParty}
            onChange={(event) =>
              setAccountableParty(event.currentTarget.value as ConsortiumParty)
            }
          >
            <option value="client">Client</option>
            <option value="partner">Partner</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Named owner
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={ownerUserId}
            disabled={props.pending || ownerOptions.length === 0}
            onChange={(event) => setOwnerUserId(event.currentTarget.value)}
          >
            <option value="">Select a current named member</option>
            {ownerOptions.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Due date (optional)
          <input
            type="datetime-local"
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={dueAt}
            onChange={(event) => setDueAt(event.currentTarget.value)}
          />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={props.pending || !ownerUserId}>
          Add proposed responsibility
        </Button>
      </div>
    </form>
  );
}

function ResponsibilityCard(props: {
  item: ConsortiumResponsibility;
  participants: readonly ConsortiumParticipantOption[];
  roomVersion: number;
  actorParty: ConsortiumParty;
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [reasonCode, setReasonCode] =
    useState<ConsortiumReasonCode>("scope_unclear");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.item.workstreamLabel);
  const [owner, setOwner] = useState(props.item.ownerUserId);
  const [responsible, setResponsible] = useState(props.item.responsibleParty);
  const [accountable, setAccountable] = useState(props.item.accountableParty);
  const [dueAt, setDueAt] = useState("");
  const currentPartyDecision = props.item.acceptances[props.actorParty];
  const mayDecide =
    props.canWrite &&
    props.item.status === "proposed" &&
    !currentPartyDecision &&
    props.item.createdByUserId !== props.actorUserId;
  const mayRevise =
    props.canWrite &&
    props.item.status !== "active" &&
    (props.actorParty === props.item.responsibleParty ||
      props.actorParty === props.item.accountableParty);
  const ownerOptions = participantsFor(props.participants, responsible);
  const ownerIsSelectable = ownerOptions.some(
    (participant) => participant.userId === owner,
  );

  return (
    <article className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{props.item.workstreamLabel}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Iteration {props.item.iteration} · owner{" "}
            {participantName(
              props.participants,
              props.item.ownerUserId,
              props.item.responsibleParty,
            )}
          </p>
        </div>
        <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium">
          {props.item.status.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 rounded-lg bg-muted/35 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Responsible</dt>
          <dd className="mt-1 capitalize">{props.item.responsibleParty}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Accountable</dt>
          <dd className="mt-1 capitalize">{props.item.accountableParty}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Client acceptance</dt>
          <dd className="mt-1">
            {props.item.acceptances.client?.decision ?? "Required"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Partner acceptance</dt>
          <dd className="mt-1">
            {props.item.acceptances.partner?.decision ?? "Required"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Due {dateTime(props.item.dueAt)}
      </p>

      {editing ? (
        <form
          className="mt-4 grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            props.onMutate({
              kind: "revision",
              path: `responsibilities/${props.item.id}/revisions`,
              body: {
                expectedVersion: props.roomVersion,
                workstreamLabel: label.trim(),
                responsibleParty: responsible,
                accountableParty: accountable,
                ownerUserId: owner.trim(),
                dueAt: localIso(dueAt),
              },
            });
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            Workstream label
            <input
              required
              maxLength={160}
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Named owner
            <select
              required
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={owner}
              disabled={props.pending || ownerOptions.length === 0}
              onChange={(event) => setOwner(event.currentTarget.value)}
            >
              {ownerOptions.every(
                (participant) => participant.userId !== owner,
              ) ? (
                <option value="">Select a current named member</option>
              ) : null}
              {ownerOptions.map((participant) => (
                <option key={participant.userId} value={participant.userId}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Responsible party
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={responsible}
              onChange={(event) => {
                setResponsible(event.currentTarget.value as ConsortiumParty);
                setOwner("");
              }}
            >
              <option value="client">Client</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Accountable party
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={accountable}
              onChange={(event) =>
                setAccountable(event.currentTarget.value as ConsortiumParty)
              }
            >
              <option value="client">Client</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Due date (optional)
            <input
              type="datetime-local"
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={dueAt}
              onChange={(event) => setDueAt(event.currentTarget.value)}
            />
          </label>
          <div className="flex items-end justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={props.pending || !ownerIsSelectable}
            >
              Submit revision
            </Button>
          </div>
        </form>
      ) : null}

      {props.canWrite ? (
        <div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t pt-4">
          {mayRevise ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              Revise
            </Button>
          ) : null}
          {mayDecide ? (
            <>
              <label className="grid gap-1 text-xs font-medium">
                Change reason
                <select
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={reasonCode}
                  onChange={(event) =>
                    setReasonCode(
                      event.currentTarget.value as ConsortiumReasonCode,
                    )
                  }
                >
                  {REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={props.pending}
                onClick={() =>
                  props.onMutate({
                    kind: "responsibility_decision",
                    path: `responsibilities/${props.item.id}/decisions`,
                    body: {
                      expectedVersion: props.roomVersion,
                      decision: "changes_requested",
                      reasonCode,
                    },
                  })
                }
              >
                Request changes
              </Button>
              <Button
                type="button"
                disabled={props.pending}
                onClick={() =>
                  props.onMutate({
                    kind: "responsibility_decision",
                    path: `responsibilities/${props.item.id}/decisions`,
                    body: {
                      expectedVersion: props.roomVersion,
                      decision: "accepted",
                    },
                  })
                }
              >
                <UserRoundCheck className="mr-2 size-4" aria-hidden="true" />
                Accept for {props.actorParty}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function QaCard(props: {
  item: ConsortiumQaItem;
  participants: readonly ConsortiumParticipantOption[];
  roomVersion: number;
  actorParty: ConsortiumParty;
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [reasonCode, setReasonCode] = useState<ConsortiumReasonCode>(
    "evidence_not_sufficient",
  );
  const mayPrepare =
    props.canWrite &&
    props.item.required &&
    props.item.status === "open" &&
    props.item.preparerParty === props.actorParty &&
    props.item.ownerUserId === props.actorUserId;
  const mayCheck =
    props.canWrite &&
    props.item.required &&
    props.item.status === "ready_for_check" &&
    props.item.checkerParty === props.actorParty &&
    props.item.preparedByUserId !== props.actorUserId;

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {QA_LABELS[props.item.code]}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.item.preparerParty} prepares · {props.item.checkerParty}{" "}
            checks
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs">
          {props.item.required
            ? props.item.status.replaceAll("_", " ")
            : "not required"}
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Named owner{" "}
        {participantName(
          props.participants,
          props.item.ownerUserId,
          props.item.preparerParty,
        )}
      </p>
      {props.item.evidenceSha256 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Evidence {short(props.item.evidenceSha256, 10, 8)}
        </p>
      ) : null}
      {mayPrepare ? (
        <div className="mt-4 grid gap-2">
          <label className="grid gap-1 text-xs font-medium">
            QA evidence SHA-256
            <input
              required
              minLength={64}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              autoComplete="off"
              className="min-h-10 rounded-md border border-input bg-background px-3 font-mono text-sm"
              value={evidenceSha256}
              onChange={(event) => setEvidenceSha256(event.currentTarget.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={props.pending || evidenceSha256.length !== 64}
            onClick={() =>
              props.onMutate({
                kind: "qa_preparation",
                path: `qa/${props.item.id}/preparations`,
                body: {
                  expectedVersion: props.roomVersion,
                  evidenceSha256,
                },
              })
            }
          >
            Ready for independent check
          </Button>
        </div>
      ) : null}
      {mayCheck ? (
        <div className="mt-4 grid gap-2">
          <select
            aria-label={`${QA_LABELS[props.item.code]} rejection reason`}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={reasonCode}
            onChange={(event) =>
              setReasonCode(event.currentTarget.value as ConsortiumReasonCode)
            }
          >
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABELS[reason]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={() =>
                props.onMutate({
                  kind: "qa_decision",
                  path: `qa/${props.item.id}/decisions`,
                  body: {
                    expectedVersion: props.roomVersion,
                    decision: "rejected",
                    reasonCode,
                  },
                })
              }
            >
              Reject check
            </Button>
            <Button
              type="button"
              disabled={props.pending}
              onClick={() =>
                props.onMutate({
                  kind: "qa_decision",
                  path: `qa/${props.item.id}/decisions`,
                  body: {
                    expectedVersion: props.roomVersion,
                    decision: "checked",
                  },
                })
              }
            >
              <FileCheck2 className="mr-2 size-4" aria-hidden="true" />
              Check
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PartnerConsortiumWorkspace(props: {
  snapshot: ConsortiumSnapshot;
  participants: readonly ConsortiumParticipantOption[];
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const room = props.snapshot.room;
  const latestReceipt = room.auditReceipts.at(-1)!;
  return (
    <div className="space-y-6">
      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <ShieldCheck className="size-5 text-emerald-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">
            Exact relationship bound
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Every read and write rechecks this active relationship and project.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <UserRoundCheck className="size-5 text-sky-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">
            Bilateral maker-checker
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A maker cannot approve their row; both parties must accept it.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <LockKeyhole className="size-5 text-violet-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Coordination only</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            No agreement generation, settlement, messaging, learning, or
            external action exists here.
          </p>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Room state
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {room.status.replaceAll("_", " ")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You are acting for the {props.snapshot.actorParty} party · version{" "}
              {room.version}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{room.auditReceipts.length} immutable receipts</div>
            <div className="mt-1 font-mono">
              Head {short(latestReceipt.receiptSha256, 10, 8)}
            </div>
          </div>
        </div>
        {room.status === "ready_for_client_release" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Coordination checks are complete. This is readiness evidence only;
            the room cannot sign, release, submit, or send anything.
          </p>
        ) : null}
      </section>

      {props.canWrite ? (
        <AddResponsibilityForm
          participants={props.participants}
          version={room.version}
          pending={props.pending}
          onMutate={props.onMutate}
        />
      ) : null}

      <section className="space-y-3" aria-labelledby="responsibility-heading">
        <div>
          <h2 id="responsibility-heading" className="text-lg font-semibold">
            Responsibility matrix
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {room.responsibilities.length} bounded workstream
            {room.responsibilities.length === 1 ? "" : "s"}
          </p>
        </div>
        {room.responsibilities.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <ClipboardCheck
              className="mx-auto size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold">No responsibilities recorded</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No ownership or acceptance has been inferred.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {room.responsibilities.map((item) => (
              <ResponsibilityCard
                key={item.id}
                item={item}
                participants={props.participants}
                roomVersion={room.version}
                actorParty={props.snapshot.actorParty}
                actorUserId={props.actorUserId}
                canWrite={props.canWrite}
                pending={props.pending}
                onMutate={props.onMutate}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="qa-heading">
        <div>
          <h2 id="qa-heading" className="text-lg font-semibold">
            QA and co-sign checklist
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fixed checks with named preparers, opposite-party checkers, and hash
            evidence.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {room.qaChecklist.map((item) => (
            <QaCard
              key={item.id}
              item={item}
              participants={props.participants}
              roomVersion={room.version}
              actorParty={props.snapshot.actorParty}
              actorUserId={props.actorUserId}
              canWrite={props.canWrite}
              pending={props.pending}
              onMutate={props.onMutate}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-muted/25 p-4 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Retention follows the owning client project. Independent deletion is
            disabled, and every mutation appends a content-free chained receipt.
          </p>
        </div>
      </section>
    </div>
  );
}
