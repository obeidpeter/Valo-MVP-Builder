import {
  useListBoqChecks,
  useRunBoqChecks,
  useBoqCheckToDefect,
  getListBoqChecksQueryKey,
  getListDefectsQueryKey,
  useListDocuments,
  useGetBoqVerification,
  getGetBoqVerificationQueryKey,
  useGetBoqVerificationRun,
  getGetBoqVerificationRunQueryKey,
  useCreateBoqVerificationRun,
  resolveBoqVerificationException,
  type BoqVerificationException,
  type BoqVerificationLine,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Calculator,
  Plus,
  Upload,
  FileSpreadsheet,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { read as readWorkbook, utils as xlsxUtils } from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { useOrganisationPermission } from "@/contexts/organisation-context";

// ---------------------------------------------------------------------------
// Spreadsheet intake: file upload (CSV/XLSX) or paste, parsed to a grid, then
// column-mapped by the operator before checks run. Parsing is presentation
// only — all arithmetic verification stays in the server's deterministic core.
// ---------------------------------------------------------------------------

type Grid = string[][];

/** RFC-4180-ish CSV parse with quoted fields; delimiter is , ; or tab. */
function parseCsv(text: string, delimiter: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: [string, number][] = ["\t", ",", ";"].map((d) => [
    d,
    (firstLines.match(new RegExp(d === "\t" ? "\t" : `\\${d}`, "g")) ?? [])
      .length,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Parse a currency/number cell: strips ₦/$/commas, () negatives; null if blank/NaN. */
function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  let cleaned = v.replace(/[₦$€£,\s]/g, "");
  const paren = /^\((.*)\)$/.exec(cleaned);
  if (paren) cleaned = `-${paren[1]}`;
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const FIELDS = [
  {
    key: "lineRef",
    label: "Item Ref",
    pattern: /^(item\s*(no|ref)?|ref|s\/?n|no\.?|line)/i,
  },
  {
    key: "description",
    label: "Description",
    pattern: /desc|particular|work item|activity/i,
  },
  { key: "quantity", label: "Quantity", pattern: /^qty|quant/i },
  { key: "unitRate", label: "Unit Rate", pattern: /rate|unit\s*(price|cost)/i },
  {
    key: "extension",
    label: "Amount / Extension",
    pattern: /amount|extension|^ext|total(?!s)/i,
  },
  { key: "amountInWords", label: "Amount in Words", pattern: /words/i },
  { key: "section", label: "Section / Bill", pattern: /section|bill|part/i },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
const UNMAPPED = "-1";

function autoMap(header: string[]): Record<FieldKey, string> {
  const mapping = Object.fromEntries(
    FIELDS.map((f) => [f.key, UNMAPPED]),
  ) as Record<FieldKey, string>;
  const taken = new Set<number>();
  for (const field of FIELDS) {
    const idx = header.findIndex(
      (h, i) => !taken.has(i) && field.pattern.test(h.trim()),
    );
    if (idx >= 0) {
      mapping[field.key] = String(idx);
      taken.add(idx);
    }
  }
  return mapping;
}

export function BoqTab({ projectId }: { projectId: string }) {
  const canWriteDefects = useOrganisationPermission("defect:write");
  const { data: checks, isLoading } = useListBoqChecks(projectId);
  const runChecks = useRunBoqChecks();
  const toDefect = useBoqCheckToDefect();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pasteData, setPasteData] = useState("");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, UNMAPPED])) as Record<
      FieldKey,
      string
    >,
  );
  const [grandTotal, setGrandTotal] = useState("");
  const [tolerance, setTolerance] = useState("");

  const loadGrid = (g: Grid, name: string) => {
    if (g.length === 0) {
      toast({
        variant: "destructive",
        title: "No rows found in the spreadsheet",
      });
      return;
    }
    setGrid(g);
    setSourceName(name);
    setHasHeader(true);
    setMapping(autoMap(g[0].map((c) => c ?? "")));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const wb = readWorkbook(await file.arrayBuffer());
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = xlsxUtils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          raw: false,
          defval: "",
        });
        loadGrid(
          rows
            .map((r) => r.map((c) => String(c ?? "")))
            .filter((r) => r.some((c) => c.trim() !== "")),
          file.name,
        );
      } else {
        const text = await file.text();
        loadGrid(parseCsv(text, detectDelimiter(text)), file.name);
      }
    } catch (err) {
      console.error("BOQ parse failed", err);
      toast({
        variant: "destructive",
        title: "Could not parse the spreadsheet file",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePasteLoad = () => {
    loadGrid(parseCsv(pasteData, detectDelimiter(pasteData)), "pasted data");
    setPasteData("");
  };

  const dataRows = grid ? (hasHeader ? grid.slice(1) : grid) : [];
  const columnCount = grid ? Math.max(...grid.map((r) => r.length)) : 0;
  const columnLabel = (i: number) =>
    grid && hasHeader && grid[0][i]?.trim()
      ? grid[0][i].trim()
      : `Column ${i + 1}`;

  const cellFor = (row: string[], key: FieldKey): string | undefined => {
    const idx = Number(mapping[key]);
    return idx >= 0 ? row[idx] : undefined;
  };

  const handleRunChecks = () => {
    const rows = dataRows
      .map((r) => ({
        lineRef: cellFor(r, "lineRef")?.trim() || undefined,
        description: cellFor(r, "description")?.trim() || undefined,
        quantity: parseNum(cellFor(r, "quantity")),
        unitRate: parseNum(cellFor(r, "unitRate")),
        extension: parseNum(cellFor(r, "extension")),
        amountInWords: cellFor(r, "amountInWords")?.trim() || null,
        section: cellFor(r, "section")?.trim() || null,
      }))
      .filter(
        (r) =>
          r.lineRef ||
          r.description ||
          r.quantity != null ||
          r.unitRate != null ||
          r.extension != null,
      );
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "No usable rows after mapping" });
      return;
    }
    const gt = parseNum(grandTotal);
    const tol = parseNum(tolerance);
    runChecks.mutate(
      {
        id: projectId,
        data: {
          rows,
          grandTotal: gt ?? undefined,
          tolerance: tol ?? undefined,
        },
      },
      {
        onSuccess: (result) => {
          setGrid(null);
          setGrandTotal("");
          setTolerance("");
          queryClient.invalidateQueries({
            queryKey: getListBoqChecksQueryKey(projectId),
          });
          toast({
            title: `Checked ${result.total} row(s)`,
            description: `${result.flagged} finding(s).${
              result.computedGrandTotal != null
                ? ` Computed grand total: ${result.computedGrandTotal.toLocaleString()}`
                : ""
            }`,
          });
        },
        onError: () =>
          toast({ variant: "destructive", title: "BOQ check run failed" }),
      },
    );
  };

  const handleToDefect = (id: string) => {
    toDefect.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListBoqChecksQueryKey(projectId),
          });
          queryClient.invalidateQueries({
            queryKey: getListDefectsQueryKey(projectId),
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">BOQ Verifier</h2>
      </div>

      {canWriteDefects &&
        (!grid ? (
          <div className="bg-card border border-border p-4 rounded-lg shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Load BOQ Data</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upload a CSV or Excel file, or paste rows straight from a
                  spreadsheet. You'll map the columns before checks run.
                </p>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFile}
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload CSV / XLSX
              </Button>
            </div>
            <Textarea
              placeholder="…or paste columns from Excel / Google Sheets here"
              className="min-h-[110px] font-mono text-sm"
              value={pasteData}
              onChange={(e) => setPasteData(e.target.value)}
            />
            <Button
              onClick={handlePasteLoad}
              disabled={!pasteData.trim()}
              variant="outline"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Load Pasted Rows
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border p-4 rounded-lg shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">
                  Map Columns — {sourceName}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {dataRows.length} data row(s). Confirm which column feeds each
                  check field; unmapped fields are skipped.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Discard loaded data"
                onClick={() => setGrid(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={hasHeader}
                onCheckedChange={(v) => setHasHeader(v === true)}
              />
              First row is a header row
            </label>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    {f.label}
                  </label>
                  <Select
                    value={mapping[f.key]}
                    onValueChange={(val) =>
                      setMapping({ ...mapping, [f.key]: val })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED}>— not present —</SelectItem>
                      {Array.from({ length: columnCount }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {columnLabel(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="border border-border rounded-md overflow-x-auto">
              <table className="text-xs w-full">
                <tbody>
                  {dataRows.slice(0, 6).map((r, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-border last:border-0"
                    >
                      {Array.from(
                        { length: Math.min(columnCount, 10) },
                        (_, ci) => (
                          <td
                            key={ci}
                            className="px-2 py-1.5 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis"
                          >
                            {r[ci] ?? ""}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {dataRows.length > 6 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  +{dataRows.length - 6} more row(s)
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Declared Grand Total (optional)
                </label>
                <Input
                  className="h-8 w-44 text-sm"
                  placeholder="e.g. 1,250,000.00"
                  value={grandTotal}
                  onChange={(e) => setGrandTotal(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-xs font-medium text-muted-foreground uppercase"
                  title="Zero by default: one kobo of drift is a finding."
                >
                  Tolerance (optional, ₦)
                </label>
                <Input
                  className="h-8 w-32 text-sm"
                  placeholder="0"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                />
              </div>
              <Button onClick={handleRunChecks} disabled={runChecks.isPending}>
                {runChecks.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4 mr-2" />
                )}
                Run Arithmetic Checks
              </Button>
            </div>
          </div>
        ))}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : checks && checks.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Status</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => {
                const varianceKobo =
                  typeof check.extensionKobo === "number" &&
                  typeof check.computedExtensionKobo === "number"
                    ? check.extensionKobo - check.computedExtensionKobo
                    : null;
                const variance =
                  varianceKobo != null
                    ? varianceKobo / 100
                    : typeof check.extension === "number" &&
                        typeof check.computedExtension === "number"
                      ? check.extension - check.computedExtension
                      : null;
                return (
                  <TableRow key={check.id}>
                    <TableCell>
                      <Badge
                        variant={
                          check.severity === "fatal" ||
                          check.severity === "likely_fatal"
                            ? "destructive"
                            : check.status === "pushed_to_defect"
                              ? "secondary"
                              : "outline"
                        }
                        className="capitalize text-xs"
                      >
                        {check.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{check.lineRef}</div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{check.finding}</p>
                      <p className="text-xs text-muted-foreground mt-1 capitalize">
                        {check.checkType.replace(/_/g, " ")}
                        {check.quantityRaw ? ` / qty ${check.quantityRaw}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      {variance ? (
                        <span
                          className="text-sm font-mono font-medium text-destructive"
                          title={
                            varianceKobo != null
                              ? `${varianceKobo} kobo`
                              : undefined
                          }
                        >
                          {variance > 0 ? "+" : ""}
                          {variance.toLocaleString()}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWriteDefects && check.status === "flagged" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToDefect(check.id)}
                          disabled={toDefect.isPending}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Defect
                        </Button>
                      )}
                      {check.status === "pushed_to_defect" && (
                        <Badge
                          variant="outline"
                          className="text-blue-600 border-blue-200 bg-blue-50"
                        >
                          Defect Logged
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <Calculator className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No BOQ checks run yet.</p>
          </div>
        )}
      </div>

      <CommercialVerificationSection
        projectId={projectId}
        dataRows={dataRows}
        cellFor={cellFor}
        mapping={mapping}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commercial verification (v2): the server pins the Nigeria rule pack, binds
// each run to the current cleared version of a governed project document, and
// records lot-level tax/discount/bid-security exceptions for named-human
// resolution. All decimals travel as strings — floats never carry money.
// ---------------------------------------------------------------------------

/** Normalise a workbook money/number cell to a plain decimal string. */
function toDecimalString(value: string | undefined): string | null {
  if (value == null) return null;
  let cleaned = value.replace(/[₦$€£,\s]/g, "");
  const paren = /^\((.*)\)$/.exec(cleaned);
  if (paren) cleaned = `-${paren[1]}`;
  if (!/^-?\d{1,24}(\.\d{1,12})?$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizeLineId(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? "").replace(/[^\w./:-]/g, "-").slice(0, 100);
  return /[\w]/.test(cleaned) ? cleaned : fallback;
}

function percentToBasisPoints(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100);
}

const SEVERITY_LABEL: Record<string, string> = {
  fatal: "Fatal",
  likely_fatal: "Likely fatal",
  scoring_risk: "Scoring risk",
};

function CommercialVerificationSection({
  projectId,
  dataRows,
  cellFor,
  mapping,
}: {
  projectId: string;
  dataRows: string[][];
  cellFor: (row: string[], key: FieldKey) => string | undefined;
  mapping: Record<FieldKey, string>;
}) {
  const canRun = useOrganisationPermission("defect:write");
  const canResolve = useOrganisationPermission("defect:review");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: snapshot, isLoading: snapshotLoading } =
    useGetBoqVerification(projectId);
  const { data: documents } = useListDocuments(projectId, {
    query: { enabled: canRun },
  });
  const createRun = useCreateBoqVerificationRun();

  const [documentId, setDocumentId] = useState("");
  const [lotRef, setLotRef] = useState("lot-1");
  const [declaredNet, setDeclaredNet] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [declaredDiscount, setDeclaredDiscount] = useState("");
  const [declaredTaxableBase, setDeclaredTaxableBase] = useState("");
  const [declaredVat, setDeclaredVat] = useState("");
  const [declaredGross, setDeclaredGross] = useState("");
  const [declaredNetPayable, setDeclaredNetPayable] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [resolveTarget, setResolveTarget] =
    useState<BoqVerificationException | null>(null);
  const [resolveStatus, setResolveStatus] = useState<"resolved" | "waived">(
    "resolved",
  );
  const [resolveReason, setResolveReason] = useState("");

  const activeRunId = selectedRunId ?? snapshot?.runs[0]?.id ?? null;
  const { data: runDetail } = useGetBoqVerificationRun(
    projectId,
    activeRunId ?? "",
    {
      query: {
        queryKey: getGetBoqVerificationRunQueryKey(
          projectId,
          activeRunId ?? "",
        ),
        enabled: Boolean(activeRunId),
      },
    },
  );

  const resolveException = useMutation({
    mutationFn: async (input: {
      exception: BoqVerificationException;
      status: "resolved" | "waived";
      reason: string;
    }) =>
      resolveBoqVerificationException(
        projectId,
        input.exception.id,
        { status: input.status, reason: input.reason },
        { headers: { "If-Match": `"${input.exception.version}"` } },
      ),
    onSuccess: () => {
      setResolveTarget(null);
      setResolveReason("");
      queryClient.invalidateQueries({
        queryKey: getGetBoqVerificationQueryKey(projectId),
      });
      if (activeRunId) {
        queryClient.invalidateQueries({
          queryKey: getGetBoqVerificationRunQueryKey(projectId, activeRunId),
        });
      }
      toast({ title: "Exception resolution recorded" });
    },
    onError: () =>
      toast({
        variant: "destructive",
        title: "Resolution failed",
        description:
          "The exception may have changed in another session. Reload and retry.",
      }),
  });

  const requiredColumnsMapped =
    mapping.quantity !== UNMAPPED &&
    mapping.unitRate !== UNMAPPED &&
    mapping.extension !== UNMAPPED;

  const handleRunVerification = () => {
    const net = toDecimalString(declaredNet);
    const vat = toDecimalString(declaredVat);
    const gross = toDecimalString(declaredGross);
    const discountBp = percentToBasisPoints(discountPercent);
    const discount = declaredDiscount.trim()
      ? toDecimalString(declaredDiscount)
      : "0";
    const lotId = sanitizeLineId(lotRef, "lot-1");
    if (!documentId) {
      toast({
        variant: "destructive",
        title: "Select the governed source document for this workbook",
      });
      return;
    }
    if (net == null || vat == null || gross == null || discount == null) {
      toast({
        variant: "destructive",
        title: "Declared net, VAT and gross totals are required decimals",
      });
      return;
    }
    if (discountBp == null) {
      toast({
        variant: "destructive",
        title: "Discount percentage must be between 0 and 100",
      });
      return;
    }
    const taxable = declaredTaxableBase.trim()
      ? toDecimalString(declaredTaxableBase)
      : discount === "0"
        ? net
        : null;
    if (taxable == null) {
      toast({
        variant: "destructive",
        title: "A discounted bid needs its declared taxable base",
      });
      return;
    }
    const netPayable = declaredNetPayable.trim()
      ? toDecimalString(declaredNetPayable)
      : gross;
    if (netPayable == null) {
      toast({
        variant: "destructive",
        title: "Declared net payable must be a decimal",
      });
      return;
    }

    const lines: BoqVerificationLine[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    dataRows.forEach((row, index) => {
      const quantity = toDecimalString(cellFor(row, "quantity"));
      const unitRate = toDecimalString(cellFor(row, "unitRate"));
      const extension = toDecimalString(cellFor(row, "extension"));
      if (quantity == null && unitRate == null && extension == null) return;
      if (quantity == null || unitRate == null || extension == null) {
        skipped += 1;
        return;
      }
      let id = sanitizeLineId(cellFor(row, "lineRef"), `row-${index + 1}`);
      while (seen.has(id)) id = `${id}.${index + 1}`;
      seen.add(id);
      lines.push({
        id,
        lotId,
        currency: "NGN",
        quantity,
        unitRate,
        displayedExtension: extension,
      });
    });
    if (lines.length === 0) {
      toast({
        variant: "destructive",
        title: "No fully priced rows to verify",
        description:
          "Commercial verification needs quantity, rate and amount on each row.",
      });
      return;
    }

    createRun.mutate(
      {
        projectId,
        data: {
          documentId,
          lines,
          lots: [
            {
              lotId,
              currency: "NGN",
              declaredNet: net,
              discountRateBasisPoints: discountBp,
              declaredDiscount: discount,
              declaredTaxableBase: taxable,
              vatRateBasisPoints: 750,
              declaredVat: vat,
              declaredGross: gross,
              declaredNetPayable: netPayable,
            },
          ],
        },
      },
      {
        onSuccess: (result) => {
          setSelectedRunId(result.run.id);
          queryClient.invalidateQueries({
            queryKey: getGetBoqVerificationQueryKey(projectId),
          });
          toast({
            title: result.run.passed
              ? "Commercial verification passed"
              : `${result.run.exceptionCount} exception(s) recorded`,
            description: `Rule pack ${result.run.rulePackId}.${
              skipped > 0
                ? ` ${skipped} partially priced row(s) were excluded.`
                : ""
            }`,
          });
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: "Commercial verification failed",
            description:
              "Check the source document selection and declared totals, then retry.",
          }),
      },
    );
  };

  return (
    <div className="bg-card border border-border p-4 rounded-lg shadow-xs space-y-4">
      <div>
        <h3 className="text-sm font-medium">Commercial verification</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lot-level VAT, discount and total reconciliation under the pinned
          Nigeria rule pack
          {snapshot ? ` (${snapshot.rulePackId})` : ""}. Verification checks
          client-supplied figures only; a pass is not a pricing or award
          opinion.
        </p>
      </div>

      {canRun && dataRows.length > 0 && (
        <div className="space-y-3 border border-border rounded-md p-3">
          {!requiredColumnsMapped ? (
            <p className="text-xs text-muted-foreground">
              Map the Quantity, Unit Rate and Amount columns above to enable
              commercial verification of the loaded rows.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Source document (governed)
                  </label>
                  <Select value={documentId} onValueChange={setDocumentId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select the uploaded BOQ document" />
                    </SelectTrigger>
                    <SelectContent>
                      {(documents ?? []).map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Lot reference
                  </label>
                  <Input
                    className="h-8 text-sm"
                    value={lotRef}
                    onChange={(e) => setLotRef(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared net total
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 4,000,000.00"
                    value={declaredNet}
                    onChange={(e) => setDeclaredNet(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Discount % (0 if none)
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="0"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared discount
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="0.00"
                    value={declaredDiscount}
                    onChange={(e) => setDeclaredDiscount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared taxable base
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="defaults to net"
                    value={declaredTaxableBase}
                    onChange={(e) => setDeclaredTaxableBase(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared VAT (7.5%)
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 300,000.00"
                    value={declaredVat}
                    onChange={(e) => setDeclaredVat(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared gross total
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 4,300,000.00"
                    value={declaredGross}
                    onChange={(e) => setDeclaredGross(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared net payable
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="defaults to gross"
                    value={declaredNetPayable}
                    onChange={(e) => setDeclaredNetPayable(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={handleRunVerification}
                disabled={createRun.isPending}
              >
                {createRun.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4 mr-2" />
                )}
                Run Commercial Verification
              </Button>
            </>
          )}
        </div>
      )}

      {snapshotLoading ? (
        <div className="p-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : snapshot && snapshot.runs.length > 0 ? (
        <>
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Exceptions</TableHead>
                  <TableHead>Rule pack</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.runs.map((run) => (
                  <TableRow
                    key={run.id}
                    className={
                      run.id === activeRunId ? "bg-muted/40" : "cursor-pointer"
                    }
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <TableCell className="text-xs font-mono">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={run.passed ? "outline" : "destructive"}
                        className="text-xs"
                      >
                        {run.passed ? "Passed" : "Exceptions recorded"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {run.exceptionCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.rulePackId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {runDetail && runDetail.exceptions.length > 0 && (
            <div className="border border-border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Exception</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Lot / Line</TableHead>
                    <TableHead>Finding</TableHead>
                    <TableHead className="text-right">
                      Expected / Actual (kobo)
                    </TableHead>
                    <TableHead>Status</TableHead>
                    {canResolve && <TableHead className="w-[90px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetail.exceptions.map((exception) => (
                    <TableRow key={exception.id}>
                      <TableCell className="text-xs font-mono">
                        {exception.exceptionCode}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            exception.severity === "scoring_risk"
                              ? "secondary"
                              : "destructive"
                          }
                          className="text-xs"
                        >
                          {SEVERITY_LABEL[exception.severity] ??
                            exception.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {exception.lotReference ?? "-"}
                        {exception.cellReference
                          ? ` / ${exception.cellReference}`
                          : ""}
                      </TableCell>
                      <TableCell className="text-sm max-w-[320px]">
                        {exception.finding}
                        {exception.resolutionReason && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {exception.status}: {exception.resolutionReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {exception.expectedMinor ?? "-"} /{" "}
                        {exception.actualMinor ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {exception.status}
                        </Badge>
                      </TableCell>
                      {canResolve && (
                        <TableCell className="text-right">
                          {exception.status === "open" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResolveTarget(exception);
                                setResolveStatus("resolved");
                                setResolveReason("");
                              }}
                            >
                              Resolve
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {canResolve && resolveTarget && (
            <div className="border border-border rounded-md p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Recording a decision for{" "}
                <span className="font-mono">{resolveTarget.exceptionCode}</span>{" "}
                — your identity and reason are kept on the exception.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  value={resolveStatus}
                  onValueChange={(value) =>
                    setResolveStatus(value === "waived" ? "waived" : "resolved")
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="waived">Waived</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 flex-1 min-w-[220px] text-sm"
                  placeholder="Reason (required, kept on record)"
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!resolveReason.trim() || resolveException.isPending}
                  onClick={() =>
                    resolveException.mutate({
                      exception: resolveTarget,
                      status: resolveStatus,
                      reason: resolveReason.trim(),
                    })
                  }
                >
                  {resolveException.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Record decision
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResolveTarget(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No commercial verification runs recorded for this pursuit. This only
          means the register is empty — it does not verify any workbook.
        </p>
      )}
    </div>
  );
}
