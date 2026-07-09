import { useState } from "react";
import {
  useListRequirements,
  useExtractRequirements,
  useCreateRequirement,
  useUpdateRequirement,
  useMergeRequirements,
  useGetProjectScorecard,
  getListRequirementsQueryKey,
  getGetProjectScorecardQueryKey,
  type Requirement,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Zap, CheckSquare, Target, Check, X, Pencil, Plus, Bot, UserRound, GitMerge } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["eligibility", "administrative", "technical", "financial_format", "other"] as const;

interface EditForm {
  text: string;
  category: (typeof CATEGORIES)[number];
  expectedEvidence: string;
  isMandatory: boolean;
  reviewerNotes: string;
}

export function RequirementsTab({ projectId }: { projectId: string }) {
  const { data: requirements, isLoading } = useListRequirements(projectId);
  const { data: scorecard } = useGetProjectScorecard(projectId);
  const extractReqs = useExtractRequirements();
  const createReq = useCreateRequirement();
  const updateReq = useUpdateRequirement();
  const mergeReqs = useMergeRequirements();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Requirement | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({
    text: "",
    category: "other",
    expectedEvidence: "",
    isMandatory: true,
    reviewerNotes: "",
  });
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListRequirementsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectScorecardQueryKey(projectId) });
  };

  const handleExtract = () => {
    extractReqs.mutate({ id: projectId }, { onSuccess: refresh });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSurvivorId(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (survivorId === id) setSurvivorId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedReqs = (requirements ?? []).filter((r) => selectedIds.has(r.id));

  const openMerge = () => {
    // Default the survivor to the first selected row so the reviewer can just
    // confirm, but let them change it in the dialog.
    setSurvivorId((cur) => cur ?? selectedReqs[0]?.id ?? null);
    setMergeOpen(true);
  };

  const handleMerge = () => {
    if (!survivorId || selectedIds.size < 2) return;
    mergeReqs.mutate(
      { id: projectId, data: { requirementIds: Array.from(selectedIds), survivorId } },
      {
        onSuccess: () => {
          setMergeOpen(false);
          exitSelectMode();
          refresh();
          toast({ title: "Requirements merged" });
        },
        onError: () => toast({ variant: "destructive", title: "Could not merge requirements" }),
      },
    );
  };

  const citationOf = (r: Requirement) =>
    [r.pageRef, r.clauseRef].filter(Boolean).join(", ") || (r.sourceDocName ?? "no citation");

  const rule = (req: Requirement, reviewStatus: "confirmed" | "rejected") => {
    setActingId(req.id);
    updateReq.mutate(
      { id: req.id, data: { reviewStatus } },
      {
        onSuccess: refresh,
        onError: () =>
          toast({ variant: "destructive", title: `Could not ${reviewStatus === "confirmed" ? "confirm" : "reject"} requirement` }),
        onSettled: () => setActingId(null),
      },
    );
  };

  const openEdit = (req: Requirement) => {
    setForm({
      text: req.text,
      category: req.category,
      expectedEvidence: req.expectedEvidence ?? "",
      isMandatory: req.isMandatory,
      reviewerNotes: req.reviewerNotes ?? "",
    });
    setEditing(req);
  };

  const openAdd = () => {
    setForm({ text: "", category: "other", expectedEvidence: "", isMandatory: true, reviewerNotes: "" });
    setAdding(true);
  };

  const closeDialog = () => {
    setEditing(null);
    setAdding(false);
  };

  const handleSave = () => {
    if (!form.text.trim()) {
      toast({ variant: "destructive", title: "Requirement text is required" });
      return;
    }
    const common = {
      onSuccess: () => {
        closeDialog();
        refresh();
      },
      onError: () => toast({ variant: "destructive", title: "Could not save requirement" }),
    };
    if (editing) {
      // Saving an edit both applies the changes and rules the row "edited"
      // (verified-with-changes) — the reviewer stamp is applied server-side.
      updateReq.mutate(
        {
          id: editing.id,
          data: {
            text: form.text.trim(),
            category: form.category,
            expectedEvidence: form.expectedEvidence.trim() || undefined,
            isMandatory: form.isMandatory,
            reviewerNotes: form.reviewerNotes.trim() || undefined,
            reviewStatus: form.text.trim() === editing.text && editing.reviewStatus !== "suggested"
              ? undefined
              : "edited",
          },
        },
        common,
      );
    } else {
      createReq.mutate(
        {
          id: projectId,
          data: {
            text: form.text.trim(),
            category: form.category,
            expectedEvidence: form.expectedEvidence.trim() || undefined,
            isMandatory: form.isMandatory,
          },
        },
        common,
      );
    }
  };

  const totals = scorecard?.totals;
  const reviewedAny =
    !!totals &&
    totals.engineConfirmed + totals.engineEdited + totals.engineRejected + totals.manualVerified > 0;
  const saving = createReq.isPending || updateReq.isPending;

  const statusBadge = (req: Requirement) => {
    switch (req.reviewStatus) {
      case "suggested":
        return <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">suggested</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10">rejected</Badge>;
      case "edited":
        return <Badge variant="default" className="text-[10px]">edited</Badge>;
      case "confirmed":
        return <Badge variant="default" className="text-[10px]">confirmed</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px] capitalize">{req.reviewStatus}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Requirement Matrix</h2>
        <div className="flex gap-2">
          {selectMode ? (
            <>
              <span className="self-center text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button onClick={openMerge} disabled={selectedIds.size < 2} variant="default">
                <GitMerge className="w-4 h-4 mr-2" />
                Merge Selected
              </Button>
              <Button onClick={exitSelectMode} variant="ghost">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => setSelectMode(true)}
                variant="outline"
                disabled={!requirements || requirements.length < 2}
                title="Fold near-duplicate requirements into one"
              >
                <GitMerge className="w-4 h-4 mr-2" />
                Merge
              </Button>
              <Button onClick={openAdd} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Add Requirement
              </Button>
              <Button onClick={handleExtract} disabled={extractReqs.isPending} variant="secondary">
                {extractReqs.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                AI Extraction
              </Button>
            </>
          )}
        </div>
      </div>

      {reviewedAny && totals && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs shadow-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <Target className="w-3.5 h-3.5 text-primary" />
            <span className="uppercase tracking-wider text-muted-foreground">Gate 0 Scorecard</span>
          </div>
          <span title="Engine-alone mandatory recall: verified mandatory requirements the AI surfaced ÷ all verified mandatory requirements. Gate 0 target ≥ 85%.">
            Mandatory recall:{" "}
            <strong>
              {totals.mandatoryRecall == null ? "—" : `${(totals.mandatoryRecall * 100).toFixed(1)}%`}
            </strong>
            {totals.mandatoryRecall != null && (
              <span className={totals.mandatoryRecall >= 0.85 ? "text-emerald-600" : "text-destructive"}>
                {" "}({totals.mandatoryRecall >= 0.85 ? "meets" : "below"} 85% gate)
              </span>
            )}
          </span>
          <span>Engine confirmed: <strong>{totals.engineConfirmed}</strong></span>
          <span>Edited: <strong>{totals.engineEdited}</strong></span>
          <span title="Engine suggestions a reviewer rejected (false positives).">
            Rejected: <strong>{totals.engineRejected}</strong>
          </span>
          <span title="Requirements a reviewer added that the engine missed.">
            Manual adds: <strong>{totals.manualVerified}</strong>
          </span>
          {totals.engineUnreviewed > 0 && (
            <span className="text-muted-foreground">{totals.engineUnreviewed} awaiting review</span>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : requirements && requirements.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                {selectMode && <TableHead className="w-[44px]" />}
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead>Requirement</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="w-[130px] text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((req) => (
                <TableRow
                  key={req.id}
                  className={`${req.reviewStatus === "rejected" ? "opacity-50" : ""} ${
                    selectMode && selectedIds.has(req.id) ? "bg-primary/5" : ""
                  }`.trim() || undefined}
                >
                  {selectMode && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(req.id)}
                        onCheckedChange={() => toggleSelected(req.id)}
                        aria-label="Select requirement to merge"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      {statusBadge(req)}
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={req.origin === "manual" ? "Added by a reviewer" : req.origin === "engine" ? "AI-extracted" : "Pre-tracking row"}>
                        {req.origin === "manual" ? (
                          <><UserRound className="w-3 h-3" /> manual</>
                        ) : req.origin === "engine" ? (
                          <><Bot className="w-3 h-3" /> engine</>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium leading-relaxed">{req.text}</p>
                    {(req.pageRef || req.clauseRef) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Ref: {[req.pageRef, req.clauseRef].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {req.reviewStatus === "edited" && req.engineText && req.engineText !== req.text && (
                      <p className="text-xs text-muted-foreground mt-1 italic" title="Original AI proposal, kept for the engine-vs-human diff.">
                        Engine proposed: “{req.engineText}”
                      </p>
                    )}
                    {req.reviewedByName && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Reviewed by {req.reviewedByName}
                        {req.reviewedAt ? ` · ${new Date(req.reviewedAt).toLocaleString()}` : ""}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge variant="secondary" className="capitalize text-[10px]">{req.category.replace('_', ' ')}</Badge>
                      {req.isMandatory && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">mandatory</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {req.confidence && (
                      <Badge variant="outline" className={`capitalize text-[10px] ${
                        req.confidence === 'high' ? 'text-emerald-600 border-emerald-200 bg-emerald-50' :
                        req.confidence === 'medium' ? 'text-amber-600 border-amber-200 bg-amber-50' :
                        'text-destructive border-destructive/20 bg-destructive/10'
                      }`}>
                        {req.confidence}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {req.reviewStatus === "suggested" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Confirm as-is"
                            disabled={actingId === req.id}
                            onClick={() => rule(req, "confirmed")}
                          >
                            <Check className="w-4 h-4 text-emerald-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Reject (false positive)"
                            disabled={actingId === req.id}
                            onClick={() => rule(req, "rejected")}
                          >
                            <X className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="icon" title="Edit and confirm with changes" onClick={() => openEdit(req)}>
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No requirements extracted yet.</p>
            <Button variant="outline" className="mt-4" onClick={handleExtract} disabled={extractReqs.isPending}>
              Run AI Extraction
            </Button>
          </div>
        )}
      </div>

      <Dialog open={!!editing || adding} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editing ? "Edit Requirement" : "Add Requirement"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editing?.engineText && (
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium">Engine proposal:</span> {editing.engineText}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">Requirement Text</label>
              <Textarea
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                className="min-h-[90px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">Category</label>
                <Select
                  value={form.category}
                  onValueChange={(val) => setForm({ ...form, category: val as EditForm["category"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">Expected Evidence</label>
                <Input
                  value={form.expectedEvidence}
                  onChange={(e) => setForm({ ...form, expectedEvidence: e.target.value })}
                  placeholder="e.g. FIRS tax clearance certificate"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isMandatory}
                onCheckedChange={(v) => setForm({ ...form, isMandatory: v === true })}
              />
              Mandatory requirement
            </label>
            {editing && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">Reviewer Notes</label>
                <Textarea
                  value={form.reviewerNotes}
                  onChange={(e) => setForm({ ...form, reviewerNotes: e.target.value })}
                  className="min-h-[60px]"
                  placeholder="Why the change was made"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? "Save & Mark Edited" : "Add as Confirmed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={(open) => setMergeOpen(open)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="font-serif">Merge Requirements</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Choose which requirement survives. The others are folded into it and their source
              citations are preserved on the surviving row. Linked evidence and defects move to the
              survivor.
            </p>
            <div className="space-y-2">
              {selectedReqs.map((r) => {
                const isSurvivor = survivorId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSurvivorId(r.id)}
                    className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                      isSurvivor ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{r.text}</span>
                      {isSurvivor && (
                        <Badge variant="default" className="text-[10px] shrink-0">survivor</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">Citation: {citationOf(r)}</span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Combined citations
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {selectedReqs.map((r) => (
                  <li key={r.id}>
                    {citationOf(r)}
                    {survivorId === r.id ? " (survivor)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={!survivorId || mergeReqs.isPending}>
              {mergeReqs.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Merge {selectedIds.size} into one
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
