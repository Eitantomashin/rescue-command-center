"use client";

import { useMemo, useState } from "react";

export type ImportedResidentOption = {
  id: string;
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

type ResidentGroup = {
  floor: string;
  apartments: Array<{
    apartment: string;
    residents: ImportedResidentOption[];
  }>;
};

function fullName(row: ImportedResidentOption) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "דייר ללא שם";
}

function genderLabel(gender: string | null) {
  if (gender === "male") return "זכר";
  if (gender === "female") return "נקבה";
  return "לא ידוע";
}

function locationLabel(row: ImportedResidentOption) {
  return [row.floor ? `קומה ${row.floor}` : "קומה לא ידועה", row.apartment ? `דירה ${row.apartment}` : "דירה לא ידועה"]
    .filter(Boolean)
    .join(" • ");
}

function searchableText(row: ImportedResidentOption) {
  return [
    fullName(row),
    row.floor,
    row.apartment,
    genderLabel(row.gender),
    row.age?.toString(),
    row.phone,
    row.notes,
    row.linked_resident_id ? "כבר שויך משויך" : "פנוי"
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, "he", { numeric: true, sensitivity: "base" });
}

function groupRows(rows: ImportedResidentOption[]): ResidentGroup[] {
  const byFloor = new Map<string, Map<string, ImportedResidentOption[]>>();

  rows.forEach((row) => {
    const floor = row.floor?.trim() || "לא ידועה";
    const apartment = row.apartment?.trim() || "לא ידועה";
    const floorGroup = byFloor.get(floor) ?? new Map<string, ImportedResidentOption[]>();
    const apartmentGroup = floorGroup.get(apartment) ?? [];
    apartmentGroup.push(row);
    floorGroup.set(apartment, apartmentGroup);
    byFloor.set(floor, floorGroup);
  });

  return Array.from(byFloor.entries())
    .sort(([floorA], [floorB]) => naturalCompare(floorA, floorB))
    .map(([floor, apartments]) => ({
      floor,
      apartments: Array.from(apartments.entries())
        .sort(([apartmentA], [apartmentB]) => naturalCompare(apartmentA, apartmentB))
        .map(([apartment, residents]) => ({
          apartment,
          residents: residents.sort((a, b) => fullName(a).localeCompare(fullName(b), "he"))
        }))
    }));
}

export function ImportedResidentLinkPicker({
  rows,
  action,
  releaseAction,
  incidentId,
  siteId,
  residentId,
  linkedImportedResident,
  canRelease
}: {
  rows: ImportedResidentOption[];
  action: (formData: FormData) => void | Promise<void>;
  releaseAction: (formData: FormData) => void | Promise<void>;
  incidentId: string;
  siteId: string;
  residentId: string;
  linkedImportedResident: ImportedResidentOption | null;
  canRelease: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const availableRows = rows.filter((row) => !row.linked_resident_id);
  const filteredRows = useMemo(() => {
    const matches = normalizedQuery ? rows.filter((row) => searchableText(row).includes(normalizedQuery)) : rows;
    return matches;
  }, [normalizedQuery, rows]);
  const groupedRows = useMemo(() => groupRows(filteredRows), [filteredRows]);

  return (
    <div className="resident-import-link-panel">
      <button className="button secondary" type="button" onClick={() => setIsOpen(true)}>
        בחר מרשימת דיירים
      </button>

      {linkedImportedResident ? (
        <div className="imported-linked-summary">
          <span className="status-badge success">משויך לרשימה</span>
          <strong>{fullName(linkedImportedResident)}</strong>
          <span>{locationLabel(linkedImportedResident)}</span>
          {canRelease ? (
            <form action={releaseAction}>
              <input type="hidden" name="incidentId" value={incidentId} />
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="importedResidentId" value={linkedImportedResident.id} />
              <button className="button secondary" type="submit">
                שחרר שיוך דייר
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {isOpen ? (
        <div className="resident-import-modal" role="dialog" aria-modal="true" aria-label="בחירת דייר מרשימת דיירים">
          <div className="resident-import-modal-backdrop" onClick={() => setIsOpen(false)} />
          <div className="resident-import-modal-content">
            <div className="resident-import-modal-header">
              <div>
                <h4>בחירת דייר מרשימת דיירים</h4>
                <p className="muted">בחר דייר פנוי לפי קומה ודירה. דייר שכבר שויך חסום לבחירה נוספת.</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setIsOpen(false)}>
                סגור
              </button>
            </div>

            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש לפי שם, דירה, קומה, טלפון או הערות"
              autoFocus
            />

            <div className="resident-import-structured-list">
              {groupedRows.length === 0 ? <p className="muted">לא נמצאו דיירים לפי החיפוש.</p> : null}
              {groupedRows.map((floorGroup) => (
                <section className="resident-import-floor" key={floorGroup.floor}>
                  <h5>קומה {floorGroup.floor}</h5>
                  {floorGroup.apartments.map((apartmentGroup) => (
                    <div className="resident-import-apartment" key={`${floorGroup.floor}-${apartmentGroup.apartment}`}>
                      <h6>דירה {apartmentGroup.apartment}</h6>
                      <div className="resident-import-residents">
                        {apartmentGroup.residents.map((row) => {
                          const linked = Boolean(row.linked_resident_id);
                          return (
                            <div className={`resident-import-row ${linked ? "is-linked" : ""}`} key={row.id}>
                              <div className="resident-import-row-main">
                                <strong>{fullName(row)}</strong>
                                <span>{genderLabel(row.gender)}</span>
                                <span>{row.age === null ? "גיל לא ידוע" : `גיל ${row.age}`}</span>
                                {row.phone ? <span>{row.phone}</span> : null}
                                {row.notes ? <em>{row.notes}</em> : null}
                              </div>
                              <div className="resident-import-row-actions">
                                <span className={`status-badge ${linked ? "neutral" : "success"}`}>
                                  {linked ? "כבר שויך" : "פנוי"}
                                </span>
                                {linked ? null : (
                                  <form action={action}>
                                    <input type="hidden" name="incidentId" value={incidentId} />
                                    <input type="hidden" name="siteId" value={siteId} />
                                    <input type="hidden" name="residentId" value={residentId} />
                                    <input type="hidden" name="importedResidentId" value={row.id} />
                                    <button className="button" type="submit">
                                      בחר דייר
                                    </button>
                                  </form>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            {availableRows.length === 0 ? <p className="muted">אין דיירים פנויים לשיוך ברשימה המיובאת.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}