"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { saveEquipmentItem, saveEquipmentType } from "./actions";
import { catalogSummary, filterEquipmentItems, runtimeLabel, serviceabilityLabels } from "./catalog-model";
import type { EquipmentItem, EquipmentType, ItemFilters, SaveResult } from "./catalog-model";
import styles from "./equipment.module.css";

function ActiveBadge({ active }: { active: boolean }) {
  return <span className={`${styles.badge} ${active ? styles.good : styles.neutral}`}>{active ? "פעיל" : "מושבת"}</span>;
}

function CatalogForm({ children, action, originallyActive, onSaved, onCancel }: {
  children: ReactNode;
  action: (form: FormData) => Promise<SaveResult>;
  originallyActive?: boolean;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const errorId = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = new FormData(event.currentTarget);
    if (form.get("isActive") === "false" && originallyActive !== false &&
      !window.confirm("האם לאשר את השבתת הרשומה בקטלוג הציוד?")) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const result = await action(form);
      if (result.ok) onSaved(result.message);
      else setError(result.message);
    } catch {
      setError("לא התקבלה תשובה מהשרת. יש לבדוק את החיבור ולרענן לפני ניסיון שמירה נוסף.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return <form onSubmit={submit} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    <fieldset disabled={pending} className={styles.fields}>
      {children}
      <div className={styles.formActions}>
        <OperationalLoadingButton label="שמירה" loadingLabel="שומר..." isLoading={pending} />
        <button type="button" className="button secondary" onClick={onCancel}>ביטול</button>
      </div>
    </fieldset>
    {error && <p id={errorId} className="error" role="alert">{error}</p>}
  </form>;
}

function ActiveField({ active = true }: { active?: boolean }) {
  return <label>מצב בקטלוג<select className="input" name="isActive" defaultValue={String(active)} required>
    <option value="true">פעיל</option><option value="false">מושבת</option>
  </select></label>;
}

function TypeEditor({ type, onSaved, onCancel }: {
  type: EquipmentType | null; onSaved: (message: string) => void; onCancel: () => void;
}) {
  return <div className={styles.editor}>
    <h3>{type ? `עריכת סוג ציוד: ${type.name}` : "סוג ציוד חדש"}</h3>
    <CatalogForm action={saveEquipmentType} originallyActive={type?.is_active} onSaved={onSaved} onCancel={onCancel}>
      {type && <input type="hidden" name="id" value={type.id} />}
      <label>שם סוג הציוד<input autoFocus className="input" name="name" defaultValue={type?.name ?? ""} required /></label>
      <label>קטגוריה<input className="input" name="category" defaultValue={type?.category ?? ""} required placeholder="למשל: תאורה" /></label>
      <label>זמן עבודה — שעות<input className="input" type="number" name="runtimeHours" min="0" step="1" defaultValue={type ? Math.floor(type.full_runtime_seconds / 3600) : 1} required /></label>
      <label>זמן עבודה — דקות<input className="input" type="number" name="runtimeMinutes" min="0" max="59.999999" step="any" defaultValue={type ? (type.full_runtime_seconds % 3600) / 60 : 0} required /></label>
      <label>התרעה לפני תדלוק — בדקות<input className="input" type="number" name="warningMinutes" min="0.016666666666666666" step="any" defaultValue={type ? type.warning_before_seconds / 60 : 30} required /></label>
      <ActiveField active={type?.is_active} />
      <label className={styles.fullWidth}>הוראות או הערות תפעוליות<textarea className="input" name="instructions" rows={3} defaultValue={type?.instructions ?? ""} /></label>
    </CatalogForm>
  </div>;
}

function ItemEditor({ item, types, onSaved, onCancel }: {
  item: EquipmentItem | null; types: EquipmentType[]; onSaved: (message: string) => void; onCancel: () => void;
}) {
  return <div className={styles.editor}>
    <h3>{item ? `עריכת פריט: ${item.asset_identifier}` : "פריט ציוד חדש"}</h3>
    <CatalogForm action={saveEquipmentItem} originallyActive={item?.is_active} onSaved={onSaved} onCancel={onCancel}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <label>סוג הציוד<select autoFocus className="input" name="equipmentTypeId" defaultValue={item?.equipment_type_id ?? ""} required>
        <option value="" disabled>בחירת סוג ציוד</option>
        {types.map((type) => <option key={type.id} value={type.id}>{type.name}{!type.is_active ? " (מושבת)" : ""}</option>)}
      </select></label>
      <label>מספר או כינוי ציוד<input className="input" name="assetIdentifier" defaultValue={item?.asset_identifier ?? ""} required /></label>
      <label>מספר סידורי (לא חובה)<input className="input" name="serialNumber" defaultValue={item?.serial_number ?? ""} /></label>
      <label>מצב כשירות<select className="input" name="serviceability" defaultValue={item?.serviceability ?? "serviceable"} required>
        {Object.entries(serviceabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <ActiveField active={item?.is_active} />
      <label className={styles.fullWidth}>הערות<textarea className="input" name="notes" rows={3} defaultValue={item?.notes ?? ""} /></label>
    </CatalogForm>
  </div>;
}

export function EquipmentCatalog({ types, items }: { types: EquipmentType[]; items: EquipmentItem[] }) {
  const router = useRouter();
  // undefined = editor closed; null = new record.
  const [editingType, setEditingType] = useState<EquipmentType | null | undefined>(undefined);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState("");
  const [filters, setFilters] = useState<ItemFilters>({ query: "", typeId: "", serviceability: "", active: "" });
  const [message, setMessage] = useState("");
  const summary = catalogSummary(types, items);
  const typeMap = new Map(types.map((type) => [type.id, type]));
  const visibleTypes = types.filter((type) => !typeFilter || type.is_active === (typeFilter === "active"));
  const visibleItems = filterEquipmentItems(items, filters);
  const setFilter = (key: keyof ItemFilters, value: string) => setFilters((previous) => ({ ...previous, [key]: value }));
  function saved(kind: "type" | "item", notice: string) {
    if (kind === "type") setEditingType(undefined);
    else setEditingItem(undefined);
    setMessage(notice);
    router.refresh();
  }

  return <main className={`page ${styles.catalog}`} dir="rtl">
    <header className="header"><div><h1>ניהול ציוד</h1><p className="muted">קטלוג הציוד של היחידה — סוגי ציוד ופריטים פיזיים.</p></div></header>
    <dl className={styles.summary} aria-label="תמונת מצב הקטלוג">
      {[["סוגי ציוד פעילים", summary.activeTypes], ["פריטים פעילים", summary.activeItems], ["פריטים לא כשירים", summary.unserviceable], ["פריטים מושבתים", summary.inactiveItems]].map(([label, count]) =>
        <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl>
    <p className={styles.summaryNote}>מצב הכשירות נפרד מהשבתה: מניין הפריטים הלא כשירים כולל גם פריטים מושבתים.</p>
    <div role="status" aria-live="polite">{message && <p className={styles.success}>{message}</p>}</div>
    <nav className={styles.sectionLinks} aria-label="אזורי קטלוג"><a className="button secondary" href="#equipment-types">סוגי ציוד</a><a className="button secondary" href="#equipment-items">פריטי ציוד</a></nav>

    <section id="equipment-types" className={`panel ${styles.section}`} aria-labelledby="equipment-types-title">
      <div className={styles.sectionHeading}><div><h2 id="equipment-types-title">סוגי ציוד</h2><p className="muted">הגדרות משותפות לפריטים מאותו סוג: קטגוריה, זמני עבודה והוראות.</p></div>
        <button className="button" disabled={editingType !== undefined} onClick={() => { setMessage(""); setEditingType(null); }}>הוספת סוג ציוד</button>
      </div>
      {editingType !== undefined && <TypeEditor key={editingType?.id ?? "new"} type={editingType} onSaved={(notice) => saved("type", notice)} onCancel={() => setEditingType(undefined)} />}
      <label className={styles.typeFilter}>הצגת סוגים<select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
        <option value="">פעילים ומושבתים</option><option value="active">פעילים בלבד</option><option value="inactive">מושבתים בלבד</option>
      </select></label>
      <div className={styles.cards}>
        {visibleTypes.map((type) => <article className={styles.card} key={type.id}>
          <div className={styles.cardHeading}><h3>{type.name}</h3><ActiveBadge active={type.is_active} /></div>
          <dl className={styles.details}><div><dt>קטגוריה</dt><dd>{type.category}</dd></div><div><dt>זמן עבודה מלא</dt><dd>{runtimeLabel(type.full_runtime_seconds)}</dd></div><div><dt>התרעה לפני תדלוק</dt><dd>{Number((type.warning_before_seconds / 60).toFixed(2))} דקות</dd></div></dl>
          {type.instructions && <p className={styles.notes}>{type.instructions}</p>}
          <button className="button secondary" disabled={editingType !== undefined} onClick={() => { setMessage(""); setEditingType(type); }} aria-label={`עריכת סוג הציוד ${type.name}`}>עריכה ושינוי מצב</button>
        </article>)}
      </div>
      {!visibleTypes.length && <p className="muted">{types.length ? "אין סוגי ציוד התואמים לסינון." : "טרם הוגדרו סוגי ציוד. יש להוסיף סוג לפני יצירת פריט פיזי."}</p>}
    </section>

    <section id="equipment-items" className={`panel ${styles.section}`} aria-labelledby="equipment-items-title">
      <div className={styles.sectionHeading}><div><h2 id="equipment-items-title">פריטי ציוד</h2><p className="muted">כל רשומה מייצגת פריט פיזי מזוהה, עם סוג ציוד ומצב כשירות משלו.</p></div>
        <button className="button" disabled={!types.length || editingItem !== undefined} onClick={() => { setMessage(""); setEditingItem(null); }}>הוספת פריט ציוד</button>
      </div>
      {!types.length && <p className="muted">להוספת פריט, יש ליצור תחילה סוג ציוד באזור שלמעלה.</p>}
      {editingItem !== undefined && <ItemEditor key={editingItem?.id ?? "new"} item={editingItem} types={types} onSaved={(notice) => saved("item", notice)} onCancel={() => setEditingItem(undefined)} />}
      <div className={styles.filters}>
        <label>חיפוש פריט<input className="input" type="search" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} placeholder="מספר, כינוי או מספר סידורי" /></label>
        <label>סוג ציוד<select className="input" value={filters.typeId} onChange={(event) => setFilter("typeId", event.target.value)}><option value="">כל הסוגים</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}{!type.is_active ? " (מושבת)" : ""}</option>)}</select></label>
        <label>כשירות<select className="input" value={filters.serviceability} onChange={(event) => setFilter("serviceability", event.target.value)}><option value="">כל מצבי הכשירות</option>{Object.entries(serviceabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>מצב בקטלוג<select className="input" value={filters.active} onChange={(event) => setFilter("active", event.target.value)}><option value="">פעילים ומושבתים</option><option value="active">פעילים בלבד</option><option value="inactive">מושבתים בלבד</option></select></label>
      </div>
      <div className={styles.filterStatus}><span aria-live="polite">מוצגים {visibleItems.length} מתוך {items.length} פריטים</span><button type="button" className="button secondary" onClick={() => setFilters({ query: "", typeId: "", serviceability: "", active: "" })}>ניקוי סינון</button></div>
      <div className={styles.cards}>
        {visibleItems.map((item) => {
          const type = typeMap.get(item.equipment_type_id);
          return <article className={styles.card} key={item.id}>
            <div className={styles.cardHeading}><h3><bdi>{item.asset_identifier}</bdi></h3><ActiveBadge active={item.is_active} /></div>
            <span className={`${styles.badge} ${item.serviceability === "serviceable" ? styles.good : item.serviceability === "restricted" ? styles.warning : styles.bad}`}>{serviceabilityLabels[item.serviceability] ?? "כשירות לא ידועה"}</span>
            <dl className={styles.details}><div><dt>סוג ציוד</dt><dd>{type?.name ?? "סוג לא זמין"}{type && !type.is_active && " (סוג מושבת)"}</dd></div><div><dt>מספר סידורי</dt><dd><bdi>{item.serial_number || "לא הוזן"}</bdi></dd></div></dl>
            {item.notes && <p className={styles.notes}>{item.notes}</p>}
            <button className="button secondary" disabled={editingItem !== undefined} onClick={() => { setMessage(""); setEditingItem(item); }} aria-label={`עריכת פריט ${item.asset_identifier}`}>עריכה ושינוי מצב</button>
          </article>;
        })}
      </div>
      {!visibleItems.length && <p className="muted">{items.length ? "אין פריטי ציוד התואמים לחיפוש ולסינון." : "טרם נוספו פריטי ציוד לקטלוג."}</p>}
    </section>
  </main>;
}
