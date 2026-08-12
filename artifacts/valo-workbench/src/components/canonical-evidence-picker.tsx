import { Label } from "@/components/ui/label";
import {
  evidenceBindingsFromOptions,
  type CanonicalEvidenceBinding,
  type CanonicalEvidenceOption,
} from "@/lib/canonical-evidence-options";

export function CanonicalEvidencePicker({
  id,
  label,
  options,
  value,
  onChange,
  multiple = false,
  maxSelections = 1,
  required = true,
  disabled = false,
  truncated = false,
  verificationNote,
}: {
  id: string;
  label: string;
  options: readonly CanonicalEvidenceOption[];
  value: readonly CanonicalEvidenceBinding[];
  onChange: (value: CanonicalEvidenceBinding[]) => void;
  multiple?: boolean;
  maxSelections?: number;
  required?: boolean;
  disabled?: boolean;
  truncated?: boolean;
  verificationNote?: string;
}) {
  const selected = new Set(value.map(({ documentId }) => documentId));
  const available = new Set(options.map(({ documentId }) => documentId));
  const retained = value.filter(({ documentId }) => !available.has(documentId));
  const helperText = verificationNote
    ? verificationNote
    : options.length === 0
      ? retained.length > 0
        ? "The previously bound document is preserved and will be revalidated by the server on submit. No new governed choice is available."
        : "No current malware-clean, quarantine-cleared canonical document is available in this scope."
      : truncated
        ? "Showing the latest bounded window of governed documents. Previously bound documents remain selected and are revalidated on submit."
        : multiple
          ? `Select 1–${maxSelections} current canonical documents. Hold Ctrl or Command to select more than one.`
          : "The server revalidates the selected current document version before recording the evidence digest.";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        multiple={multiple}
        size={multiple ? Math.min(6, Math.max(3, options.length)) : undefined}
        required={required}
        disabled={disabled || (options.length === 0 && retained.length === 0)}
        value={multiple ? [...selected] : (value[0]?.documentId ?? "")}
        onChange={(event) => {
          const documentIds = multiple
            ? [...event.currentTarget.selectedOptions].map(
                (option) => option.value,
              )
            : event.currentTarget.value
              ? [event.currentTarget.value]
              : [];
          if (documentIds.length > maxSelections) return;
          const byId = new Map(
            value.map((binding) => [binding.documentId, binding]),
          );
          for (const binding of evidenceBindingsFromOptions(
            options,
            documentIds.filter((documentId) => !byId.has(documentId)),
          )) {
            byId.set(binding.documentId, binding);
          }
          onChange(
            documentIds.flatMap((documentId) => {
              const binding = byId.get(documentId);
              return binding ? [binding] : [];
            }),
          );
        }}
      >
        {!multiple ? (
          <option value="" disabled>
            Select current governed evidence
          </option>
        ) : null}
        {retained.map((binding, index) => (
          <option key={binding.documentId} value={binding.documentId}>
            Previously bound document {index + 1}
            {verificationNote
              ? " — digest snapshot"
              : " — revalidated on submit"}
          </option>
        ))}
        {options.map((option) => (
          <option key={option.documentId} value={option.documentId}>
            {option.filename} — {option.projectTitle} — version{" "}
            {option.versionNumber} — {option.detectedMime}
          </option>
        ))}
      </select>
      <p className="text-xs leading-5 text-muted-foreground">{helperText}</p>
    </div>
  );
}
