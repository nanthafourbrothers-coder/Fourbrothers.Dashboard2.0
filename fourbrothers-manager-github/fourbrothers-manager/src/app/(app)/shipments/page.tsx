"use client";

// Shipments and photos: who it went to, which invoice, which courier, plus any number of photos,
// invoice scans or documents of any file type, kept with the record and searchable.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, Download, File as FileIcon, FileUp, Image as ImageIcon, Paperclip, Plus, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, deleteFiles, getFileUrl, uploadFile, useTable } from "@/lib/data/store";
import { readAnyFile } from "@/lib/parse/rawFile";
import { buildGenericTable } from "@/lib/parse/table";
import { cleanText, formatDateDisplay, formatNumber, parseDateLoose, todayYmd } from "@/lib/parse/normalize";
import { STATUS_OPTIONS, type Shipment, type ShipmentFile, type ShipmentStatus } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { Badge, Button, Field, Modal, PageHeader, useUi, type Tone } from "@/components/ui";

const STATUS_TONE: Record<ShipmentStatus, Tone> = { Pending: "amber", Packed: "blue", Dispatched: "brand", Delivered: "green", Returned: "red" };

const safeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(-90) || "file";
const isImage = (mime: string | null, name: string) => Boolean(mime?.startsWith("image/")) || /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(name);
const isPdf = (mime: string | null, name: string) => mime === "application/pdf" || /\.pdf$/i.test(name);
const sizeText = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function ShipmentsPage() {
  const auth = useAuth();
  const params = useSearchParams();
  const { toast } = useUi();
  const shipments = useTable("shipments");
  const files = useTable("shipment_files");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [photoQ, setPhotoQ] = useState("");

  const canWrite = auth.can("write");
  const canManage = auth.can("manage");

  const filesBy = useMemo(() => {
    const m = new Map<string, ShipmentFile[]>();
    for (const f of files.rows) {
      const l = m.get(f.shipment_id) ?? [];
      l.push(f);
      m.set(f.shipment_id, l);
    }
    return m;
  }, [files.rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of shipments.rows) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [shipments.rows]);

  type Row = Shipment & { file_count: number; file_names: string };
  const rows: Row[] = useMemo(
    () => shipments.rows.map((s) => ({ ...s, file_count: filesBy.get(s.id)?.length ?? 0, file_names: (filesBy.get(s.id) ?? []).map((f) => f.name).join(" ") })),
    [shipments.rows, filesBy],
  );

  const columns: GridColumn<Row>[] = [
    { key: "ship_date", label: "Date", type: "date", editable: true, width: 110 },
    { key: "customer_name", label: "Customer", editable: true, width: 200 },
    { key: "phone", label: "Phone", editable: true },
    { key: "city", label: "City", editable: true },
    { key: "state", label: "State", editable: true },
    { key: "invoice_no", label: "Invoice no", editable: true },
    { key: "courier", label: "Courier", editable: true },
    { key: "tracking_no", label: "Tracking no", editable: true },
    { key: "status", label: "Status", options: STATUS_OPTIONS, editable: true, render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
    {
      key: "file_count", label: "Files", type: "number", digits: 0,
      render: (r) => (r.file_count ? <span className="inline-flex items-center gap-1 text-ink-700"><Paperclip className="h-3.5 w-3.5" />{r.file_count}</span> : <span className="text-ink-300">0</span>),
    },
    { key: "address", label: "Address", editable: true, hidden: true },
    { key: "notes", label: "Notes", editable: true, hidden: true },
    { key: "file_names", label: "File names", hidden: true },
  ];

  // search inside the stored files by name, shown as a quick list under the table header
  const photoHits = useMemo(() => {
    const t = photoQ.trim().toLowerCase();
    if (!t) return [];
    return files.rows
      .filter((f) => f.name.toLowerCase().includes(t))
      .slice(0, 12)
      .map((f) => ({ f, s: shipments.rows.find((s) => s.id === f.shipment_id) }));
  }, [photoQ, files.rows, shipments.rows]);

  const openShipment = openId ? shipments.rows.find((s) => s.id === openId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipments and photos"
        subtitle="Keep every dispatch with its customer, phone, location, invoice and courier details, and attach packing photos, invoice scans or any file. Search by name, phone, city, invoice or file name."
        actions={
          canWrite && (
            <>
              <Button onClick={() => setImporting(true)}>
                <FileUp className="h-4 w-4" /> Import CSV or Excel
              </Button>
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New shipment
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STATUS_OPTIONS.map((s) => (
          <div key={s} className="card px-4 py-2.5">
            <p className="text-xs text-ink-500">{s}</p>
            <p className="text-xl font-semibold tabular-nums">{formatNumber(counts[s] ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="card p-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <input className="input pl-8" placeholder="Find a photo or document by file name" value={photoQ} onChange={(e) => setPhotoQ(e.target.value)} aria-label="Find a file by name" />
        </div>
        {photoQ.trim() && (
          <ul className="mt-2 divide-y divide-ink-100 text-sm">
            {photoHits.map(({ f, s }) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5">
                <Paperclip className="h-3.5 w-3.5 text-ink-400" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="truncate text-xs text-ink-500">{s?.customer_name}</span>
                {s && (
                  <Button size="sm" onClick={() => setOpenId(s.id)}>
                    Open
                  </Button>
                )}
              </li>
            ))}
            {!photoHits.length && <li className="py-2 text-ink-500">No file has that name.</li>}
          </ul>
        )}
      </div>

      <DataGrid
        id="shipments"
        title="shipments"
        rows={rows}
        rowId={(r) => r.id}
        columns={columns}
        loading={!shipments.loaded}
        canEdit={canWrite}
        canDelete={canManage}
        defaultSort={{ key: "ship_date", dir: "desc" }}
        initialSearch={params.get("q") ?? undefined}
        onRowClick={(r) => setOpenId(r.id)}
        onAdd={canWrite ? () => setAdding(true) : undefined}
        addLabel="New shipment"
        onEdit={async (r, key, value) => {
          if (key === "customer_name" && !String(value ?? "").trim()) throw new Error("Customer name is required.");
          if (key === "ship_date" && !value) throw new Error("Date is required.");
          await db.update("shipments", r.id, { [key]: value } as Partial<Shipment>);
        }}
        onDelete={async (ids) => {
          const paths = files.rows.filter((f) => ids.includes(f.shipment_id)).map((f) => f.path);
          await db.remove("shipments", ids);
          if (paths.length) await deleteFiles(paths).catch(() => undefined);
          await db.audit("delete shipments", "shipments", `${ids.length} shipments, ${paths.length} files`);
        }}
        emptyText="No shipments yet. Add one, or import a Shopify orders export from Import files to create them from your orders."
      />

      {adding && <ShipmentModal onClose={() => setAdding(false)} />}
      {openShipment && <ShipmentModal shipment={openShipment} existing={filesBy.get(openShipment.id) ?? []} onClose={() => setOpenId(null)} canWrite={canWrite} canManage={canManage} />}
      {importing && <ImportShipmentsModal onClose={() => setImporting(false)} onDone={(n) => toast("success", `${n} shipment${n === 1 ? "" : "s"} added.`)} />}
    </div>
  );
}

// ---------------------------------------------------------------- create / edit

function ShipmentModal({ shipment, existing = [], onClose, canWrite = true, canManage = true }: { shipment?: Shipment; existing?: ShipmentFile[]; onClose: () => void; canWrite?: boolean; canManage?: boolean }) {
  const { toast, confirm } = useUi();
  const movements = useTable("stock_movements").rows;
  const [f, setF] = useState({
    ship_date: shipment?.ship_date ?? todayYmd(),
    customer_name: shipment?.customer_name ?? "",
    phone: shipment?.phone ?? "",
    city: shipment?.city ?? "",
    state: shipment?.state ?? "",
    address: shipment?.address ?? "",
    invoice_no: shipment?.invoice_no ?? "",
    courier: shipment?.courier ?? "",
    tracking_no: shipment?.tracking_no ?? "",
    status: (shipment?.status ?? "Pending") as ShipmentStatus,
    notes: shipment?.notes ?? "",
  });
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<ShipmentFile | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const editable = canWrite;

  const fillFromInvoice = () => {
    const no = f.invoice_no.trim().toLowerCase();
    if (!no) return toast("info", "Type the invoice number first.");
    const hit = movements.filter((m) => m.type === "OUT" && (m.voucher_no ?? "").trim().toLowerCase() === no);
    if (!hit.length) return toast("info", "No stock-out invoice with that number was found.");
    const m = hit[0];
    setF({ ...f, customer_name: f.customer_name || m.party || "", city: f.city || m.city || "", state: f.state || m.state || "", address: f.address || m.address || "", ship_date: shipment ? f.ship_date : m.date });
    toast("success", `Filled from invoice ${m.voucher_no} (${hit.length} item line${hit.length > 1 ? "s" : ""}).`);
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list); // copy now: the input is cleared right after this call
    setPending((p) => [...p, ...picked]);
  };

  const save = async () => {
    if (!f.customer_name.trim()) return toast("error", "Customer name is required.");
    if (!f.ship_date) return toast("error", "Date is required.");
    setBusy(true);
    try {
      const payload: Partial<Shipment> = {
        ship_date: f.ship_date,
        customer_name: f.customer_name.trim(),
        phone: f.phone.trim() || null,
        city: f.city.trim() || null,
        state: f.state.trim() || null,
        address: f.address.trim() || null,
        invoice_no: f.invoice_no.trim() || null,
        courier: f.courier.trim() || null,
        tracking_no: f.tracking_no.trim() || null,
        status: f.status,
        notes: f.notes.trim() || null,
      };
      let id = shipment?.id;
      if (shipment) await db.update("shipments", shipment.id, payload);
      else {
        const [created] = await db.insert("shipments", [payload]);
        id = created.id;
      }
      let failed = 0;
      for (let i = 0; i < pending.length; i++) {
        const file = pending[i];
        setProgress(`Uploading file ${i + 1} of ${pending.length}`);
        const path = `shipments/${id}/${Date.now()}-${i}-${safeName(file.name)}`;
        try {
          await uploadFile(path, file);
          await db.insert("shipment_files", [{ shipment_id: id!, path, name: file.name, mime: file.type || null, size: file.size }]);
        } catch (e) {
          failed++;
          toast("error", `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
      if (!shipment) await db.audit("add shipment", "shipments", `${payload.customer_name} ${payload.invoice_no ?? ""}`.trim(), id);
      toast(failed ? "info" : "success", failed ? `Saved, but ${failed} file(s) did not upload.` : shipment ? "Saved." : "Shipment added.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const removeFile = async (file: ShipmentFile) => {
    if (!(await confirm(`Delete "${file.name}"? This cannot be undone.`, { danger: true, confirmLabel: "Delete file" }))) return;
    try {
      await db.remove("shipment_files", [file.id]);
      await deleteFiles([file.path]).catch(() => undefined);
      toast("success", "File deleted.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not delete the file.");
    }
  };

  return (
    <>
      <Modal
        title={shipment ? `Shipment: ${shipment.customer_name}` : "New shipment"}
        size="lg"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-xs text-ink-500">{progress}</span>
            <Button onClick={onClose}>{editable ? "Cancel" : "Close"}</Button>
            {editable && (
              <Button variant="primary" busy={busy} onClick={save}>
                Save
              </Button>
            )}
          </>
        }
      >
        <fieldset disabled={!editable} className="contents">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date *"><input className="input" type="date" value={f.ship_date} onChange={set("ship_date")} /></Field>
            <Field label="Customer name *" className="sm:col-span-2"><input className="input" value={f.customer_name} onChange={set("customer_name")} autoFocus={!shipment} /></Field>
            <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={set("phone")} /></Field>
            <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
            <Field label="State"><input className="input" value={f.state} onChange={set("state")} /></Field>
            <Field label="Address" className="sm:col-span-3"><input className="input" value={f.address} onChange={set("address")} /></Field>
            <Field label="Invoice no">
              <div className="flex gap-1.5">
                <input className="input" value={f.invoice_no} onChange={set("invoice_no")} />
                {editable && (
                  <Button size="sm" onClick={fillFromInvoice} title="Fill customer, city and address from the stock-out invoice with this number">
                    Fill
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Courier"><input className="input" value={f.courier} onChange={set("courier")} /></Field>
            <Field label="Tracking no"><input className="input" value={f.tracking_no} onChange={set("tracking_no")} /></Field>
            <Field label="Status">
              <select className="input" value={f.status} onChange={set("status")}>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
          </div>
        </fieldset>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="label !mb-0">Photos and files ({existing.length + pending.length})</p>
            {editable && (
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => pickRef.current?.click()}>
                  <FileUp className="h-3.5 w-3.5" /> Add files
                </Button>
                <Button size="sm" onClick={() => camRef.current?.click()}>
                  <Camera className="h-3.5 w-3.5" /> Take photo
                </Button>
              </div>
            )}
            <input ref={pickRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {existing.length + pending.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">Any file type works: photos, PDF invoices, Excel, Word.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {existing.map((file) => (
                <FileTile key={file.id} name={file.name} mime={file.mime} size={file.size} path={file.path} onOpen={() => setPreview(file)} onRemove={canManage ? () => removeFile(file) : undefined} />
              ))}
              {pending.map((file, i) => (
                <FileTile key={`p${i}`} name={file.name} mime={file.type} size={file.size} blob={file} pendingTag onRemove={() => setPending(pending.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
        </div>
      </Modal>
      {preview && <Lightbox file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function FileTile({ name, mime, size, path, blob, onOpen, onRemove, pendingTag }: { name: string; mime: string | null; size: number | null; path?: string; blob?: File; onOpen?: () => void; onRemove?: () => void; pendingTag?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const img = isImage(mime, name);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    if (!img) return;
    if (blob) {
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    } else if (path) {
      getFileUrl(path).then((u) => !cancelled && setUrl(u)).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [img, blob, path]);
  return (
    <div className="group relative overflow-hidden rounded-lg border border-ink-200 bg-white">
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex aspect-[4/3] w-full items-center justify-center bg-ink-50 disabled:cursor-default">
        {img && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="h-full w-full object-cover" />
        ) : img ? (
          <ImageIcon className="h-8 w-8 text-ink-300" />
        ) : (
          <FileIcon className="h-8 w-8 text-ink-300" />
        )}
      </button>
      <div className="px-2 py-1.5">
        <p className="truncate text-xs font-medium text-ink-800" title={name}>{name}</p>
        <p className="text-[11px] text-ink-500">{sizeText(size)}{pendingTag ? " | not uploaded yet" : ""}</p>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-600 shadow hover:text-red-600" aria-label={`Remove ${name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Lightbox({ file, onClose }: { file: ShipmentFile; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getFileUrl(file.path).then(setUrl).catch((e) => setErr(e instanceof Error ? e.message : "Could not open the file."));
  }, [file.path]);
  return (
    <Modal title={file.name} size="xl" onClose={onClose} footer={url ? <a className="btn" href={url} download={file.name} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /> Download</a> : undefined}>
      {err ? (
        <p className="text-sm text-red-700">{err}</p>
      ) : !url ? (
        <p className="text-sm text-ink-500">Opening…</p>
      ) : isImage(file.mime, file.name) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="mx-auto max-h-[70vh] w-auto rounded" />
      ) : isPdf(file.mime, file.name) ? (
        <iframe src={url} title={file.name} className="h-[70vh] w-full rounded border border-ink-200" />
      ) : (
        <p className="text-sm text-ink-600">This file type cannot be previewed. Use Download to open it.</p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- import

const FIELD_PATTERNS: { key: keyof Shipment; test: RegExp }[] = [
  { key: "ship_date", test: /^(ship(ment)? )?date$|^dispatch date$|^order date$|^created at$/ },
  { key: "customer_name", test: /^(customer|customer name|name|party|buyer|shipping name|billing name|consignee)$/ },
  { key: "phone", test: /^(phone|mobile|contact|phone no|mobile no|shipping phone|billing phone)$/ },
  { key: "city", test: /^(city|shipping city|billing city|town)$/ },
  { key: "state", test: /^(state|shipping province name|shipping province|province|billing province name)$/ },
  { key: "address", test: /^(address|shipping address|shipping street|full address)$/ },
  { key: "invoice_no", test: /^(invoice|invoice no|invoice number|bill no|order|order no|name)$/ },
  { key: "courier", test: /^(courier|transport|carrier|shipping method)$/ },
  { key: "tracking_no", test: /^(tracking|tracking no|tracking number|awb|lr no|docket)$/ },
  { key: "status", test: /^(status|shipment status)$/ },
  { key: "notes", test: /^(notes?|remarks?)$/ },
];

function ImportShipmentsModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const { toast } = useUi();
  const existing = useTable("shipments").rows;
  const [file, setFile] = useState<string>("");
  const [rows, setRows] = useState<Partial<Shipment>[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const read = async (f: File) => {
    setBusy(true);
    setRows([]);
    setNotes([]);
    try {
      const res = await readAnyFile(f.name, await f.arrayBuffer());
      if (!res.sheets.length) throw new Error(res.errors[0] ?? "No table found in this file.");
      const table = buildGenericTable(res.sheets[0]);
      const used = new Set<string>();
      const map = new Map<keyof Shipment, string>();
      for (const c of table.columns) {
        const label = cleanText(c.label).toLowerCase();
        for (const p of FIELD_PATTERNS) {
          if (!map.has(p.key) && !used.has(c.key) && p.test.test(label)) {
            map.set(p.key, c.key);
            used.add(c.key);
          }
        }
      }
      if (!map.has("customer_name")) throw new Error("Could not find a customer name column. Name one of the columns Customer or Name.");
      const have = new Set(existing.map((s) => (s.invoice_no ?? "").trim().toLowerCase()).filter(Boolean));
      const out: Partial<Shipment>[] = [];
      let dup = 0;
      let noName = 0;
      let noDate = 0;
      const get = (r: Record<string, unknown>, k: keyof Shipment) => (map.has(k) ? cleanText(r[map.get(k)!]) : "");
      for (const r of table.rows) {
        const name = get(r, "customer_name");
        if (!name) {
          noName++;
          continue;
        }
        const inv = get(r, "invoice_no");
        if (inv && have.has(inv.toLowerCase())) {
          dup++;
          continue;
        }
        if (inv) have.add(inv.toLowerCase());
        const d = parseDateLoose(get(r, "ship_date"));
        if (!d) noDate++;
        const st = STATUS_OPTIONS.find((s) => s.toLowerCase() === get(r, "status").toLowerCase());
        out.push({
          ship_date: d ?? todayYmd(),
          customer_name: name,
          phone: get(r, "phone") || null,
          city: get(r, "city") || null,
          state: get(r, "state") || null,
          address: get(r, "address") || null,
          invoice_no: inv || null,
          courier: get(r, "courier") || null,
          tracking_no: get(r, "tracking_no") || null,
          status: st ?? "Pending",
          notes: get(r, "notes") || null,
        });
      }
      const n: string[] = [];
      if (dup) n.push(`${dup} row(s) skipped because a shipment with the same invoice number already exists.`);
      if (noName) n.push(`${noName} row(s) skipped because the customer name is empty.`);
      if (noDate) n.push(`${noDate} row(s) had no readable date and use today's date.`);
      setNotes(n);
      setRows(out);
      setFile(f.name);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await db.insert("shipments", rows);
      await db.audit("import", "shipments", `${file}: ${saved.length} shipments`);
      onDone(saved.length);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import shipments"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!rows.length} onClick={save}>
            Add {rows.length || ""} shipment{rows.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-600">Upload a CSV or Excel file with a header row. Columns are recognised by name: Date, Customer, Phone, City, State, Address, Invoice, Courier, Tracking, Status, Notes. Shopify orders can be imported from Import files instead.</p>
      <input type="file" accept=".csv,.tsv,.xlsx,.xlsm,.json,.txt" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      {rows.length > 0 && (
        <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm">
          <p className="font-medium">{file}: {rows.length} shipment(s) ready.</p>
          <p className="mt-1 text-xs text-ink-600">First: {rows[0].customer_name}{rows[0].invoice_no ? `, invoice ${rows[0].invoice_no}` : ""}, {formatDateDisplay(rows[0].ship_date)}</p>
          {notes.map((n) => <p key={n} className="mt-1 text-xs text-amber-800">{n}</p>)}
        </div>
      )}
      {file && rows.length === 0 && <p className="mt-3 text-sm text-ink-600">Nothing new to add from that file.{notes.length ? " " + notes.join(" ") : ""}</p>}
    </Modal>
  );
}
