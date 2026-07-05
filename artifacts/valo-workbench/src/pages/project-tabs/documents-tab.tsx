import {
  useListDocuments,
  useCreateDocument,
  useDeleteDocument,
  useUpdateDocument,
  useRequestUploadUrl,
  useVerifyDocument,
  useExtractDocument,
  getListDocumentsQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Loader2, Upload, Trash2, Lock, ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw,
} from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

/** Pull the server's human-readable error message off a failed request. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  const serverError =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : undefined;
  return serverError ?? (err instanceof Error ? err.message : fallback);
}

const NDA_ALLOWED = new Set(["signed", "not_required"]);
const DOC_TYPES = ["tender", "bid", "certificate", "boq", "evidence", "other"] as const;
const REDACTION = ["excluded", "redacted", "included"] as const;
const PENDING_EXTRACTION = new Set(["pending", "extracting"]);

export function DocumentsTab({
  projectId,
  ndaStatus,
}: {
  projectId: string;
  ndaStatus?: string | null;
}) {
  const ndaCleared = !!ndaStatus && NDA_ALLOWED.has(ndaStatus);
  // Poll while any document is still extracting so the status flips live.
  const { data: documents, isLoading } = useListDocuments(projectId, {
    query: {
      refetchInterval: (query: { state: { data?: Document[] } }) =>
        query.state.data?.some((d) => PENDING_EXTRACTION.has(d.extractionStatus ?? "")) ? 2500 : false,
    } as never,
  });
  const deleteDocument = useDeleteDocument();
  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument();
  const requestUploadUrl = useRequestUploadUrl();
  const verifyDocument = useVerifyDocument();
  const extractDocument = useExtractDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isUploading, setIsUploading] = useState(false);
  const [integrity, setIntegrity] = useState<Record<string, "ok" | "failed">>({});
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(projectId) });

  const handleUploadClick = () => fileInputRef.current?.click();

  /** Infer a sensible default document type from the filename. */
  const guessType = (name: string): (typeof DOC_TYPES)[number] => {
    const n = name.toLowerCase();
    if (/\b(boq|bill.*quant)\b/.test(n) || /\.(xlsx|xls|csv)$/.test(n)) return "boq";
    if (/tender|rfp|itt|invitation/.test(n)) return "tender";
    if (/bid|proposal|submission/.test(n)) return "bid";
    if (/cert|licen|clearance|pencom|cac/.test(n)) return "certificate";
    return "other";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploading(true);
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      await createDocument.mutateAsync({
        id: projectId,
        data: {
          type: guessType(file.name),
          filename: file.name,
          objectPath,
          contentType: file.type,
          size: file.size,
          // Default excluded per confidentiality doctrine; the reviewer
          // promotes to included/redacted below so the AI steps can read it.
          redactionStatus: "excluded",
        },
      });
      refresh();
    } catch (err) {
      console.error("Upload failed", err);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: errorMessage(err, "The document could not be uploaded."),
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const patchDoc = (id: string, data: { type?: string; redactionStatus?: string }, label: string) => {
    updateDocument.mutate(
      { id, data: data as never },
      {
        onSuccess: refresh,
        onError: (err) =>
          toast({ variant: "destructive", title: `Could not update ${label}`, description: errorMessage(err, "") }),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteDocument.mutate(
      { id },
      {
        onSuccess: refresh,
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Could not delete document",
            description: errorMessage(err, "Only an admin can delete documents."),
          }),
      },
    );
  };

  const handleReextract = (id: string) => {
    extractDocument.mutate(
      { id },
      {
        onSuccess: refresh,
        onError: (err) =>
          toast({ variant: "destructive", title: "Could not start extraction", description: errorMessage(err, "") }),
      },
    );
  };

  const handleVerify = async (id: string, filename: string) => {
    setVerifyingIds((prev) => new Set(prev).add(id));
    try {
      const result = await verifyDocument.mutateAsync({ id });
      if (result.ok) {
        setIntegrity((prev) => ({ ...prev, [id]: "ok" }));
        toast({ title: "Integrity verified", description: `${filename} matches its intake SHA-256.` });
      } else if (result.actualSha256 == null) {
        toast({
          variant: "destructive",
          title: "Verification unavailable",
          description: `${filename}: the stored object could not be read — try again; if this persists, contact an administrator.`,
        });
      } else {
        setIntegrity((prev) => ({ ...prev, [id]: "failed" }));
        toast({
          variant: "destructive",
          title: "Integrity check FAILED",
          description: `${filename} does not match its intake SHA-256 — the stored file has changed.`,
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Verification unavailable",
        description: errorMessage(err, "This document could not be verified."),
      });
    } finally {
      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const extractionBadge = (doc: Document) => {
    const s = doc.extractionStatus ?? "pending";
    if (s === "extracted")
      return <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50">text ready</Badge>;
    if (s === "extracting" || s === "pending")
      return (
        <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> extracting
        </Badge>
      );
    if (s === "skipped")
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">no text (paste?)</Badge>;
    return <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10">failed</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Project Documents</h2>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        <Button onClick={handleUploadClick} disabled={isUploading || !ndaCleared}>
          {isUploading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : !ndaCleared ? (
            <Lock className="w-4 h-4 mr-2" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          Upload Document
        </Button>
      </div>

      {!ndaCleared && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Uploads are locked until this client's NDA position is recorded.
            Set the client's NDA status to <strong>signed</strong> or <strong>not required</strong> to enable document uploads.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <FileText className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          Documents are uploaded <strong>excluded</strong> by default (financial pages stay out of AI analysis).
          Set a tender/bid document's redaction to <strong>included</strong> or <strong>redacted</strong> so
          AI Extraction and Evidence mapping can read it — excluded documents are skipped by both.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents && documents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Filename</TableHead>
                <TableHead className="w-[130px]">Type</TableHead>
                <TableHead className="w-[130px]">Redaction</TableHead>
                <TableHead>Extraction</TableHead>
                <TableHead>Integrity</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[240px]">{doc.filename}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={doc.type} onValueChange={(v) => patchDoc(doc.id, { type: v }, "type")}>
                      <SelectTrigger className="h-7 text-xs capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DOC_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={doc.redactionStatus}
                      onValueChange={(v) => patchDoc(doc.id, { redactionStatus: v }, "redaction status")}
                    >
                      <SelectTrigger
                        className={`h-7 text-xs capitalize ${doc.redactionStatus === "excluded" ? "text-amber-700" : ""}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REDACTION.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize text-xs">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {extractionBadge(doc)}
                      {doc.extractionStatus === "failed" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Retry extraction"
                          onClick={() => handleReextract(doc.id)}
                          disabled={extractDocument.isPending}
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {doc.sha256 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleVerify(doc.id, doc.filename)}
                        disabled={verifyingIds.has(doc.id)}
                        title={`Intake SHA-256: ${doc.sha256}`}
                      >
                        {verifyingIds.has(doc.id) ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : integrity[doc.id] === "ok" ? (
                          <ShieldCheck className="w-4 h-4 mr-1 text-emerald-600" />
                        ) : integrity[doc.id] === "failed" ? (
                          <ShieldAlert className="w-4 h-4 mr-1 text-destructive" />
                        ) : (
                          <ShieldQuestion className="w-4 h-4 mr-1 text-muted-foreground" />
                        )}
                        <span className="text-xs">
                          {integrity[doc.id] === "ok" ? "Verified" : integrity[doc.id] === "failed" ? "FAILED" : "Verify"}
                        </span>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="Uploaded before integrity manifests — no intake hash on record.">
                        No hash
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(doc.id)}>
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No documents uploaded yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
