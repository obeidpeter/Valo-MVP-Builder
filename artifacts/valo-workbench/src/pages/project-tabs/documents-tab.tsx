import { 
  useListDocuments, 
  useCreateDocument, 
  useDeleteDocument, 
  useRequestUploadUrl,
  getListDocumentsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Loader2, Upload, Trash2, Lock } from "lucide-react";
import { useState, useRef } from "react";

const NDA_ALLOWED = new Set(["signed", "not_required"]);

export function DocumentsTab({
  projectId,
  ndaStatus,
}: {
  projectId: string;
  ndaStatus?: string | null;
}) {
  const ndaCleared = !!ndaStatus && NDA_ALLOWED.has(ndaStatus);
  const { data: documents, isLoading } = useListDocuments(projectId);
  const deleteDocument = useDeleteDocument();
  const requestUploadUrl = useRequestUploadUrl();
  const createDocument = useCreateDocument();
  const queryClient = useQueryClient();
  
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      // 1. Request URL
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type,
        }
      });

      // 2. Upload file
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      // 3. Register document
      await createDocument.mutateAsync({
        id: projectId,
        data: {
          type: "other", // Default, can be edited later
          filename: file.name,
          objectPath,
          contentType: file.type,
          size: file.size,
          redactionStatus: "excluded",
        }
      });

      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(projectId) });
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = (id: string) => {
    deleteDocument.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(projectId) })
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Project Documents</h2>
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={handleFileChange}
        />
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
            Set the client's NDA status to <strong>signed</strong> or{" "}
            <strong>not required</strong> to enable document uploads.
          </p>
        </div>
      )}

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
                <TableHead>Type</TableHead>
                <TableHead>Redaction</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      {doc.filename}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{doc.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">{doc.redactionStatus}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
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