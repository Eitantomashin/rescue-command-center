"use client";

import * as XLSX from "xlsx";
import { useMemo, useState, type ChangeEvent } from "react";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

export type ImportedSiteResidentListRow = {
  id: string;
  site_id: string;
  site_label: string;
  floor: string | null;
  apartment: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  age: number | null;
  phone: string | null;
  notes: string | null;
  linked_resident_id: string | null;
};

const requiredHeaders = ["קומה", "דירה", "שם", "שם משפחה", "מין", "גיל", "טלפון", "הערות"];

type PreviewRow = {
  floor: string;
  apartment: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: string;
  phone: string;
  notes: string;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function genderLabel(gender: string | null) {
  if (gender === "male") return "זכר";
  if (gender === "female") return "נקבה";
  return "לא ידוע";
}

function cell(row: unknown[], header: string[], name: string) {
  const index = header.indexOf(name);
  return String(index >= 0 ? row[index] ?? "" : "").trim();
}

export function SiteResidentImportForm({
  action,
  incidentId,
  siteId,
  siteLabel
}: {
  action: (formData: FormData) => void | Promise<void>;
  incidentId: string;
  siteId: string;
  siteLabel: string;
}) {
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreviewRows([]);
    setError(null);

    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("ניתן לייבא קובץ xlsx בלבד.");
      return;
    }

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        setError("קובץ הייבוא ריק.");
        return;
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
        blankrows: false
      });
      const header = (rows[0] ?? []).map(normalizeHeader);
      const missing = requiredHeaders.filter((name) => !header.includes(name));
      if (missing.length > 0) {
        setError(`קובץ הייבוא חייב לכלול עמודות: ${missing.join(", ")}`);
        return;
      }

      const parsed = rows
        .slice(1)
        .map((row) => ({
          floor: cell(row, header, "קומה"),
          apartment: cell(row, header, "דירה"),
          firstName: cell(row, header, "שם"),
          lastName: cell(row, header, "שם משפחה"),
          gender: cell(row, header, "מין"),
          age: cell(row, header, "גיל"),
          phone: cell(row, header, "טלפון"),
          notes: cell(row, header, "הערות")
        }))
        .filter((row) => row.firstName || row.lastName);

      if (parsed.length === 0) {
        setError("לא נמצאו דיירים לייבוא בקובץ.");
        return;
      }

      setPreviewRows(parsed);
    } catch {
      setError("לא ניתן לקרוא את קובץ הייבוא. ודא שזהו קובץ Excel תקין.");
    }
  }

  return (
    <details className="inline-confirm-panel site-resident-import-panel">
      <summary className="button secondary">טען רשימת דיירים</summary>
      <form action={action} className="action-form" encType="multipart/form-data">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="siteId" value={siteId} />
        <strong>טעינת רשימת דיירים - {siteLabel}</strong>
        <p className="muted">עמודות נדרשות: קומה, דירה, שם, שם משפחה, מין, גיל, טלפון, הערות</p>
        <input
          className="input"
          type="file"
          name="residentFile"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleFileChange}
          required
        />
        {error ? <p className="error">{error}</p> : null}
        {previewRows.length > 0 ? (
          <div className="import-preview">
            <div className="muted">תצוגה מקדימה: {previewRows.length} רשומות</div>
            <div className="table-wrap compact-table-wrap">
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>קומה</th>
                    <th>דירה</th>
                    <th>שם</th>
                    <th>שם משפחה</th>
                    <th>טלפון</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 8).map((row, index) => (
                    <tr key={`${row.floor}-${row.apartment}-${row.firstName}-${index}`}>
                      <td>{row.floor || "-"}</td>
                      <td>{row.apartment || "-"}</td>
                      <td>{row.firstName || "-"}</td>
                      <td>{row.lastName || "-"}</td>
                      <td>{row.phone || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewRows.length > 8 ? <p className="muted">ועוד {previewRows.length - 8} רשומות בקובץ</p> : null}
          </div>
        ) : null}
        <OperationalLoadingButton className="button" label={"\u05d0\u05e9\u05e8 \u05d9\u05d9\u05d1\u05d5\u05d0 \u05e8\u05e9\u05d9\u05de\u05d4"} loadingLabel={"\u05de\u05d9\u05d9\u05d1\u05d0..."} disabled={previewRows.length === 0 || Boolean(error)} />
      </form>
    </details>
  );
}

function searchText(row: ImportedSiteResidentListRow) {
  return [
    row.floor,
    row.apartment,
    row.first_name,
    row.last_name,
    genderLabel(row.gender),
    row.age?.toString(),
    row.phone,
    row.notes,
    row.linked_resident_id ? "משויך" : "פנוי"
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function ImportedResidentsSiteSection({ siteLabel, rows }: { siteLabel: string; rows: ImportedSiteResidentListRow[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const linkedCount = rows.filter((row) => row.linked_resident_id).length;
  const freeCount = rows.length - linkedCount;
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows;
    return rows.filter((row) => searchText(row).includes(normalizedQuery));
  }, [normalizedQuery, rows]);

  return (
    <details className="imported-residents-site-section">
      <summary className="imported-residents-site-summary">
        <span className="imported-residents-site-title">{siteLabel} - רשימת דיירים מיובאת</span>
        <span className="imported-residents-site-counts">
          {rows.length} דיירים | {linkedCount} משויכים | {freeCount} פנויים
        </span>
      </summary>
      <div className="imported-residents-site-body">
        <div className="section-heading imported-residents-site-tools">
          <div>
            <h3>{siteLabel} - רשימת דיירים מיובאת</h3>
            <p className="muted">{filteredRows.length} מתוך {rows.length} רשומות</p>
          </div>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי קומה, דירה, שם, טלפון, הערות או סטטוס"
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>קומה</th>
                <th>דירה</th>
                <th>שם</th>
                <th>שם משפחה</th>
                <th>מין</th>
                <th>גיל</th>
                <th>טלפון</th>
                <th>הערות</th>
                <th>סטטוס שיוך</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">לא נמצאו רשומות תואמות לחיפוש.</td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.floor || "-"}</td>
                    <td>{row.apartment || "-"}</td>
                    <td>{row.first_name || "-"}</td>
                    <td>{row.last_name || "-"}</td>
                    <td>{genderLabel(row.gender)}</td>
                    <td>{row.age ?? "-"}</td>
                    <td>{row.phone || "-"}</td>
                    <td>{row.notes || "-"}</td>
                    <td>
                      <span className={`status-badge ${row.linked_resident_id ? "success" : "neutral"}`}>
                        {row.linked_resident_id ? "משויך" : "פנוי"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export function ImportedSiteResidentsTable({ rows }: { rows: ImportedSiteResidentListRow[] }) {
  const groupedRows = useMemo(() => {
    const grouped = new Map<string, { siteLabel: string; rows: ImportedSiteResidentListRow[] }>();

    rows.forEach((row) => {
      const current = grouped.get(row.site_id) ?? { siteLabel: row.site_label, rows: [] };
      current.rows.push(row);
      grouped.set(row.site_id, current);
    });

    return Array.from(grouped.entries()).sort(([, first], [, second]) => first.siteLabel.localeCompare(second.siteLabel, "he"));
  }, [rows]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel imported-residents-panel">
      <div className="section-heading">
        <div>
          <h2>רשימות דיירים מיובאות</h2>
          <p className="muted">{groupedRows.length} אתרים | {rows.length} רשומות</p>
        </div>
      </div>
      <div className="imported-residents-site-list">
        {groupedRows.map(([siteId, group]) => (
          <ImportedResidentsSiteSection key={siteId} siteLabel={group.siteLabel} rows={group.rows} />
        ))}
      </div>
    </section>
  );
}