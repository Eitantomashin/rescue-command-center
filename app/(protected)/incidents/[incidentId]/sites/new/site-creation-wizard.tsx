"use client";

import { useMemo, useState } from "react";
import { createSiteFromWizard } from "./actions";
import { formatNumber } from "@/lib/format";
import { operationalTeamLabel, parseOperationalTeamNumber } from "@/lib/operational-teams";

type ZoneType =
  | "apartment"
  | "store"
  | "office"
  | "parking_area"
  | "lobby"
  | "shelter"
  | "warehouse"
  | "machine_room"
  | "commercial_area"
  | "other";

type WizardZone = {
  id: string;
  level: number;
  name: string;
  type: ZoneType;
  quantity: number;
  averagePotential: number;
};

type WizardTeam = {
  id: string;
  teamNumber: number;
  name: string;
  leader: string;
  phone: string;
  rescuers: number | "";
  selected: boolean;
};

const structureTypes = [
  ["residential", "מגורים"],
  ["office", "משרדים"],
  ["commercial", "מסחרי"],
  ["mixed", "מעורב"],
  ["school", "בית ספר"],
  ["medical", "רפואי"],
  ["other", "אחר"]
] as const;

const damageSeverities = [
  ["light", "קל"],
  ["medium", "בינוני"],
  ["heavy", "כבד"],
  ["collapse", "קריסה"]
] as const;

const zoneTypes: Array<[ZoneType, string]> = [
  ["apartment", "דירה"],
  ["store", "חנות"],
  ["office", "משרד"],
  ["parking_area", "חניה"],
  ["lobby", "לובי"],
  ["shelter", "מקלט"],
  ["warehouse", "מחסן"],
  ["machine_room", "חדר מכונות"],
  ["commercial_area", "שטח מסחרי"],
  ["other", "אחר"]
];

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function levelsBetween(lowest: number, highest: number) {
  if (lowest > highest) {
    return [];
  }

  return Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index);
}

function defaultZones(lowestLevel: number, highestLevel: number) {
  return levelsBetween(lowestLevel, highestLevel).map((level) => ({
    id: `zone-${level}-default`,
    level,
    name: level === 0 ? "דירה" : "דירה",
    type: "apartment" as ZoneType,
    quantity: 4,
    averagePotential: 5
  }));
}

const reservedSetupTeamNumbers = new Set([1, 2, 3, 9, 11, 12, 13, 91, 92, 93]);

const setupTeamOptions = [
  { teamNumber: 1, name: operationalTeamLabel(1), rescuers: 4 },
  { teamNumber: 11, name: operationalTeamLabel(11), rescuers: 4 },
  { teamNumber: 2, name: operationalTeamLabel(2), rescuers: 4 },
  { teamNumber: 12, name: operationalTeamLabel(12), rescuers: 4 },
  { teamNumber: 3, name: operationalTeamLabel(3), rescuers: 4 },
  { teamNumber: 13, name: operationalTeamLabel(13), rescuers: 4 },
  { teamNumber: 9, name: "אוכלוסיה", rescuers: "" },
  { teamNumber: 91, name: "רפואה", rescuers: "" },
  { teamNumber: 92, name: "לוגיסטיקה", rescuers: "" },
  { teamNumber: 93, name: "חפ\"ק", rescuers: "" }
] as const;

function nextCustomTeamNumber(teams: WizardTeam[]) {
  const usedTeamNumbers = new Set(teams.map((team) => team.teamNumber));

  for (let teamNumber = 20; teamNumber < 100; teamNumber += 1) {
    if (!reservedSetupTeamNumbers.has(teamNumber) && !usedTeamNumbers.has(teamNumber)) {
      return teamNumber;
    }
  }

  return 20;
}

const defaultTeams: WizardTeam[] = setupTeamOptions.map((team) => ({
  id: `team-${team.teamNumber}`,
  teamNumber: team.teamNumber,
  name: team.name,
  leader: "",
  phone: "",
  rescuers: team.rescuers,
  selected: false
}));

function teamLabel(team: WizardTeam) {
  return operationalTeamLabel(team.teamNumber, team.name);
}

export function SiteCreationWizard({ incidentId, incidentName }: { incidentId: string; incidentName: string }) {
  const [step, setStep] = useState(1);
  const [siteName, setSiteName] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [structureType, setStructureType] = useState("residential");
  const [damageSeverity, setDamageSeverity] = useState("medium");
  const [structureDescription, setStructureDescription] = useState("");
  const [lowestLevel, setLowestLevel] = useState(0);
  const [highestLevel, setHighestLevel] = useState(7);
  const [zones, setZones] = useState<WizardZone[]>(() => defaultZones(0, 7));
  const [teams, setTeams] = useState<WizardTeam[]>(defaultTeams);
  const [customTeamInput, setCustomTeamInput] = useState("");
  const [imageName, setImageName] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageError, setImageError] = useState("");

  const levels = useMemo(() => levelsBetween(lowestLevel, highestLevel), [lowestLevel, highestLevel]);
  const initialPotential = zones.reduce(
    (sum, zone) => sum + zone.quantity * zone.averagePotential,
    0
  );
  const totalZones = zones.reduce((sum, zone) => sum + zone.quantity, 0);
  const selectedTeams = teams.filter((team) => team.selected);

  function syncLevels(nextLowest: number, nextHighest: number) {
    setLowestLevel(nextLowest);
    setHighestLevel(nextHighest);

    const nextLevels = new Set(levelsBetween(nextLowest, nextHighest));
    setZones((current) => {
      const kept = current.filter((zone) => nextLevels.has(zone.level));
      const existingLevels = new Set(kept.map((zone) => zone.level));
      const additions = [...nextLevels]
        .filter((level) => !existingLevels.has(level))
        .map((level) => ({
          id: `zone-${level}-default`,
          level,
          name: "דירה",
          type: "apartment" as ZoneType,
          quantity: 4,
          averagePotential: 5
        }));

      return [...kept, ...additions].sort((a, b) => a.level - b.level);
    });
  }

  function updateZone(id: string, patch: Partial<WizardZone>) {
    setZones((current) =>
      current.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone))
    );
  }

  function addZone(level: number) {
    setZones((current) => [
      ...current,
      {
        id: uid("zone"),
        level,
        name: "אזור",
        type: "other",
        quantity: 1,
        averagePotential: 0
      }
    ]);
  }

  function updateTeam(id: string, patch: Partial<WizardTeam>) {
    setTeams((current) =>
      current.map((team) => (team.id === id ? { ...team, ...patch } : team))
    );
  }

  function addCustomTeam() {
    const customName = customTeamInput.trim();
    if (!customName) {
      return;
    }

    const parsedTeamNumber = parseOperationalTeamNumber(customName);
    if (parsedTeamNumber && reservedSetupTeamNumbers.has(parsedTeamNumber)) {
      return;
    }

    const teamNumber = parsedTeamNumber ?? nextCustomTeamNumber(teams);
    const name = customName;

    setTeams((current) => {
      if (current.some((team) => team.teamNumber === teamNumber)) {
        return current;
      }

      return [
        ...current,
        { id: uid("team"), teamNumber, name, leader: "", phone: "", rescuers: 4, selected: true }
      ];
    });
    setCustomTeamInput("");
  }

  function zoneTypeLabel(type: ZoneType) {
    return zoneTypes.find(([value]) => value === type)?.[1] ?? "אזור";
  }

  async function handleImage(file: File | null) {
    setImageError("");
    setImageName("");
    setImageDataUrl("");

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setImageError("ניתן לצרף קובץ תמונה בלבד");
      return;
    }

    if (file.size > 900_000) {
      setImageError("התמונה גדולה מדי לשמירה בשלב זה");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageName(file.name);
      setImageDataUrl(String(reader.result ?? ""));
    };
    reader.readAsDataURL(file);
  }

  return (
    <form action={createSiteFromWizard} className="wizard-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteName" value={siteName} />
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="street" value={street} />
      <input type="hidden" name="houseNumber" value={houseNumber} />
      <input type="hidden" name="structureType" value={structureType} />
      <input type="hidden" name="damageSeverity" value={damageSeverity} />
      <input type="hidden" name="structureDescription" value={structureDescription} />
      <input type="hidden" name="lowestLevel" value={lowestLevel} />
      <input type="hidden" name="highestLevel" value={highestLevel} />
      <input type="hidden" name="zonesPayload" value={JSON.stringify(zones)} />
      <input type="hidden" name="teamsPayload" value={JSON.stringify(selectedTeams)} />
      <input type="hidden" name="imageName" value={imageName} />
      <input type="hidden" name="imageDataUrl" value={imageDataUrl} />

      <div className="wizard-steps" aria-label="שלבי יצירת אתר">
        {[1, 2, 3, 4, 5, 6].map((stepNumber) => (
          <button
            className={step === stepNumber ? "wizard-step active" : "wizard-step"}
            key={stepNumber}
            type="button"
            onClick={() => setStep(stepNumber)}
          >
            {stepNumber}
          </button>
        ))}
      </div>

      {step === 1 ? (
        <section className="panel wizard-panel">
          <h2>פרטי אתר</h2>
          <p className="muted">{incidentName}</p>
          <div className="form-grid">
            <label className="field">
              <span>שם האתר</span>
              <input
                className="input"
                name="siteName"
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                placeholder="שם האתר"
              />
            </label>
            <label className="field">
              <span>עיר</span>
              <input
                className="input"
                name="city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="עיר"
              />
            </label>
            <label className="field">
              <span>כתובת האתר</span>
              <input
                className="input"
                name="street"
                value={street}
                onChange={(event) => setStreet(event.target.value)}
                placeholder="רחוב"
                required
              />
            </label>
            <label className="field">
              <span>מספר בית</span>
              <input
                className="input"
                name="houseNumber"
                value={houseNumber}
                onChange={(event) => setHouseNumber(event.target.value)}
                placeholder="מספר בית"
                required
              />
            </label>
            <label className="field">
              <span>סוג מבנה</span>
              <select
                className="input"
                name="structureType"
                value={structureType}
                onChange={(event) => setStructureType(event.target.value)}
              >
                {structureTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>חומרת נזק</span>
              <select
                className="input"
                name="damageSeverity"
                value={damageSeverity}
                onChange={(event) => setDamageSeverity(event.target.value)}
              >
                {damageSeverities.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>תיאור מבנה</span>
              <textarea
                className="input"
                name="structureDescription"
                rows={3}
                value={structureDescription}
                onChange={(event) => setStructureDescription(event.target.value)}
                placeholder="תיאור מבנה"
              />
            </label>
            <label className="file-field wide">
              <span>תמונה אופציונלית</span>
              <input className="input" type="file" accept="image/*" onChange={(event) => handleImage(event.target.files?.[0] ?? null)} />
              {imageName ? <small>{imageName}</small> : null}
              {imageError ? <small className="error">{imageError}</small> : null}
            </label>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="panel wizard-panel">
          <h2>מפלסים</h2>
          <div className="form-grid">
            <label className="field">
              <span>מפלס תחתון</span>
              <input
                className="input"
                type="number"
                value={lowestLevel}
                onChange={(event) => syncLevels(Number(event.target.value), highestLevel)}
              />
            </label>
            <label className="field">
              <span>מפלס עליון</span>
              <input
                className="input"
                type="number"
                value={highestLevel}
                onChange={(event) => syncLevels(lowestLevel, Number(event.target.value))}
              />
            </label>
          </div>
          <div className="level-preview">
            {levels.map((level) => (
              <span className="badge" key={level}>מפלס {level}</span>
            ))}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="panel wizard-panel">
          <h2>הגדרת אזורים לפי מפלס</h2>
          <div className="wizard-levels">
            {levels.map((level) => (
              <section className="wizard-level" key={level}>
                <div className="wizard-level-header">
                  <h3>מפלס {level}</h3>
                  <button className="button compact secondary" type="button" onClick={() => addZone(level)}>
                    הוסף אזור
                  </button>
                </div>
                <div className="zone-list">
                  {zones
                    .filter((zone) => zone.level === level)
                    .map((zone) => (
                      <div className="zone-row" key={zone.id}>
                        <label className="field">
                          <span>שם אזור</span>
                          <input
                            className="input"
                            value={zone.name}
                            onChange={(event) => updateZone(zone.id, { name: event.target.value })}
                            placeholder="שם אזור"
                          />
                        </label>
                        <label className="field">
                          <span>סוג אזור</span>
                          <select
                            className="input"
                            value={zone.type}
                            onChange={(event) => updateZone(zone.id, { type: event.target.value as ZoneType })}
                          >
                            {zoneTypes.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>כמות יחידות / מתחמים</span>
                          <input
                            className="input"
                            type="number"
                            min="1"
                            value={zone.quantity}
                            onChange={(event) => updateZone(zone.id, { quantity: Number(event.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span>פוטנציאל לאזור/יחידה</span>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={zone.averagePotential}
                            onChange={(event) => updateZone(zone.id, { averagePotential: Number(event.target.value) })}
                          />
                        </label>
                        <div className="zone-total">
                          <span>סה"כ פוטנציאל</span>
                          <strong>{formatNumber(zone.quantity * zone.averagePotential)}</strong>
                        </div>
                        <button
                          className="button compact secondary danger"
                          type="button"
                          onClick={() => setZones((current) => current.filter((item) => item.id !== zone.id))}
                        >
                          הסר
                        </button>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="panel wizard-panel">
          <div className="wizard-level-header">
            <h2>צוותי חילוץ</h2>
          </div>
          <div className="inline-action-panel">
            <label className="field">
              <span>אחר</span>
              <input
                className="input"
                value={customTeamInput}
                onChange={(event) => setCustomTeamInput(event.target.value)}
                placeholder="לדוגמה: צוות 4 או צוות חילוץ חיצוני"
              />
            </label>
            <button className="button secondary" type="button" onClick={addCustomTeam}>
              הוסף צוות אחר
            </button>
          </div>
          <div className="team-edit-list">
            {teams.map((team) => (
              <div className="team-edit-row" key={team.id}>
                <label className="team-select">
                  <input
                    type="checkbox"
                    checked={team.selected}
                    onChange={(event) => updateTeam(team.id, { selected: event.target.checked })}
                  />
                  <span>{teamLabel(team)}</span>
                </label>
                <input className="input" value={team.name} readOnly aria-label="שם צוות" />
                <input className="input" value={team.leader} onChange={(event) => updateTeam(team.id, { leader: event.target.value })} placeholder="מפקד צוות" disabled={!team.selected} />
                <input className="input" value={team.phone} onChange={(event) => updateTeam(team.id, { phone: event.target.value })} placeholder="טלפון" disabled={!team.selected} />
                <input className="input" type="number" min="0" value={team.rescuers} onChange={(event) => updateTeam(team.id, { rescuers: event.target.value === "" ? "" : Number(event.target.value) })} placeholder="מספר מחלצים" disabled={!team.selected} />
              </div>
            ))}
          </div>
          {selectedTeams.length === 0 ? <p className="error">יש לבחור לפחות צוות אחד לשיוך לאתר.</p> : null}
        </section>
      ) : null}

      {step === 5 ? (
        <section className="panel wizard-panel">
          <h2>חישוב פוטנציאל ראשוני</h2>
          <div className="actions">
            <button className="button compact secondary" type="button" onClick={() => setStep(3)}>
              חזרה לעריכת אזורים
            </button>
          </div>
          <div className="potential-breakdown">
            {levels.map((level) => {
              const levelZones = zones.filter((zone) => zone.level === level);
              const levelTotal = levelZones.reduce(
                (sum, zone) => sum + zone.quantity * zone.averagePotential,
                0
              );

              return (
                <section className="potential-level" key={level}>
                  <h3>קומה {level}</h3>
                  {levelZones.length === 0 ? (
                    <p className="muted">לא הוגדרו אזורים בקומה זו.</p>
                  ) : (
                    <ul>
                      {levelZones.map((zone) => (
                        <li key={zone.id}>
                          {formatNumber(zone.quantity)} כפול {zone.name} ({zoneTypeLabel(zone.type)}) כפול{" "}
                          {formatNumber(zone.averagePotential)} ={" "}
                          <strong>{formatNumber(zone.quantity * zone.averagePotential)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  <strong>סה"כ קומה: {formatNumber(levelTotal)}</strong>
                </section>
              );
            })}
          </div>
          <div className="grid">
            <div className="metric">
              מפלסים
              <strong>{formatNumber(levels.length)}</strong>
            </div>
            <div className="metric">
              אזורים / יחידות
              <strong>{formatNumber(totalZones)}</strong>
            </div>
            <div className="metric metric-emphasis">
              פוטנציאל ראשוני
              <strong>{formatNumber(initialPotential)}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {step === 6 ? (
        <section className="panel wizard-panel">
          <h2>יצירת אתר</h2>
          <p className="muted">
            תיווצר תמונת מבנה מלאה עם {formatNumber(levels.length)} מפלסים, {formatNumber(totalZones)} אזורים, {formatNumber(initialPotential)} רשומות פוטנציאל ראשוני ו-{formatNumber(selectedTeams.length)} צוותים משויכים.
          </p>
          {selectedTeams.length === 0 ? <p className="error">יש לבחור לפחות צוות אחד לפני יצירת האתר.</p> : null}
          <button className="button" type="submit" disabled={zones.length === 0 || initialPotential < 0 || selectedTeams.length === 0}>
            צור אתר
          </button>
        </section>
      ) : null}

      <div className="wizard-nav">
        <button className="button secondary" type="button" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>
          הקודם
        </button>
        <button className="button secondary" type="button" disabled={step === 6} onClick={() => setStep((current) => current + 1)}>
          הבא
        </button>
      </div>
    </form>
  );
}
