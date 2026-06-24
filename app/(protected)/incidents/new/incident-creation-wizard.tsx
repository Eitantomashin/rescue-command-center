"use client";

import { useMemo, useState } from "react";
import { createIncidentFromWizard } from "./actions";
import { formatNumber } from "@/lib/format";
import { operationalTeamLabel, parseOperationalTeamNumber } from "@/lib/operational-teams";

type WizardTeam = {
  id: string;
  teamNumber: number;
  name: string;
  leader: string;
  phone: string;
  rescuers: number | "";
  selected: boolean;
};

const incidentTypes = [
  ["missile_strike", "פגיעת טיל"],
  ["structure_collapse", "קריסת מבנה"],
  ["earthquake", "רעידת אדמה"],
  ["fire", "שריפה"],
  ["hazmat", "אירוע חומרים מסוכנים"],
  ["flood", "הצפה"],
  ["height_rescue", "חילוץ מגובה"],
  ["elevator_rescue", "חילוץ ממעלית"],
  ["other", "אחר"]
] as const;

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
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

export function IncidentCreationWizard() {
  const [step, setStep] = useState(1);
  const [incidentName, setIncidentName] = useState("");
  const [incidentType, setIncidentType] = useState("missile_strike");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const [incidentCommander, setIncidentCommander] = useState("");
  const [commanderPhone, setCommanderPhone] = useState("");
  const [deputyCommander, setDeputyCommander] = useState("");
  const [operationsOfficer, setOperationsOfficer] = useState("");
  const [populationOfficer, setPopulationOfficer] = useState("");
  const [commandNotes, setCommandNotes] = useState("");
  const [teams, setTeams] = useState<WizardTeam[]>(defaultTeams);
  const [customTeamInput, setCustomTeamInput] = useState("");

  const selectedTeams = useMemo(() => teams.filter((team) => team.selected), [teams]);
  const selectedTeamLabels = selectedTeams.map(teamLabel).join(", ");
  const canCreateIncident = Boolean(incidentName.trim() && incidentType.trim() && city.trim());
  const selectedIncidentTypeLabel =
    incidentTypes.find(([value]) => value === incidentType)?.[1] ?? "אחר";

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

  return (
    <form action={createIncidentFromWizard} className="wizard-form">
      <input type="hidden" name="incidentName" value={incidentName} />
      <input type="hidden" name="incidentType" value={incidentType} />
      <input type="hidden" name="primaryCity" value={city} />
      <input type="hidden" name="primaryAddress" value={address} />
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="address" value={address} />
      <input type="hidden" name="initialDescription" value={initialDescription} />
      <input type="hidden" name="incidentCommander" value={incidentCommander} />
      <input type="hidden" name="commanderPhone" value={commanderPhone} />
      <input type="hidden" name="deputyCommander" value={deputyCommander} />
      <input type="hidden" name="operationsOfficer" value={operationsOfficer} />
      <input type="hidden" name="populationOfficer" value={populationOfficer} />
      <input type="hidden" name="commandNotes" value={commandNotes} />
      <input type="hidden" name="teamsPayload" value={JSON.stringify(selectedTeams)} />

      <div className="wizard-steps" aria-label="שלבי פתיחת אירוע">
        {[1, 2, 3, 4].map((stepNumber) => (
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
          <h2>פרטי אירוע בסיסיים</h2>
          <div className="form-grid">
            <label className="field">
              <span>שם האירוע</span>
              <input
                className="input"
                name="incidentName"
                value={incidentName}
                onChange={(event) => setIncidentName(event.target.value)}
                placeholder="פגיעת טיל רעננה"
                required
              />
            </label>
            <label className="field">
              <span>סוג האירוע</span>
              <select
                className="input"
                name="incidentType"
                value={incidentType}
                onChange={(event) => setIncidentType(event.target.value)}
                required
              >
                {incidentTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>עיר ראשית</span>
              <input
                className="input"
                name="primaryCity"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="רעננה"
                required
              />
            </label>
            <label className="field">
              <span>כתובת / מיקום ראשי</span>
              <input
                className="input"
                name="primaryAddress"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="הרצל 5 / צומת רעננה"
              />
            </label>
            <label className="field wide">
              <span>תיאור ראשוני</span>
              <textarea
                className="input"
                name="initialDescription"
                rows={4}
                value={initialDescription}
                onChange={(event) => setInitialDescription(event.target.value)}
                placeholder="מידע ראשוני ידוע בזמן פתיחת האירוע"
              />
            </label>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="panel wizard-panel">
          <h2>מבנה פיקוד</h2>
          <div className="form-grid">
            <label className="field">
              <span>מפקד האירוע</span>
              <input
                className="input"
                name="incidentCommander"
                value={incidentCommander}
                onChange={(event) => setIncidentCommander(event.target.value)}
                placeholder="שם מפקד האירוע"
              />
            </label>
            <label className="field">
              <span>טלפון</span>
              <input
                className="input"
                name="commanderPhone"
                value={commanderPhone}
                onChange={(event) => setCommanderPhone(event.target.value)}
                placeholder="טלפון מפקד"
              />
            </label>
            <label className="field">
              <span>סגן מפקד</span>
              <input
                className="input"
                name="deputyCommander"
                value={deputyCommander}
                onChange={(event) => setDeputyCommander(event.target.value)}
                placeholder="שם סגן מפקד"
              />
            </label>
            <label className="field">
              <span>קצין אג״ם</span>
              <input
                className="input"
                name="operationsOfficer"
                value={operationsOfficer}
                onChange={(event) => setOperationsOfficer(event.target.value)}
                placeholder="שם קצין אג״ם"
              />
            </label>
            <label className="field">
              <span>קצין אוכלוסייה</span>
              <input
                className="input"
                name="populationOfficer"
                value={populationOfficer}
                onChange={(event) => setPopulationOfficer(event.target.value)}
                placeholder="שם קצין אוכלוסייה"
              />
            </label>
            <label className="field wide">
              <span>הערות פיקוד</span>
              <textarea
                className="input"
                name="commandNotes"
                rows={3}
                value={commandNotes}
                onChange={(event) => setCommandNotes(event.target.value)}
                placeholder="הערות קצרות לפתיחה"
              />
            </label>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="panel wizard-panel">
          <div className="wizard-level-header">
            <div>
              <h2>משאבים ראשוניים</h2>
              <p className="muted">נבחרו {formatNumber(selectedTeams.length)} צוותים</p>
            </div>
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
                <input
                  className="input"
                  value={team.leader}
                  onChange={(event) => updateTeam(team.id, { leader: event.target.value })}
                  placeholder="מפקד צוות"
                  disabled={!team.selected}
                />
                <input
                  className="input"
                  value={team.phone}
                  onChange={(event) => updateTeam(team.id, { phone: event.target.value })}
                  placeholder="טלפון"
                  disabled={!team.selected}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={team.rescuers}
                  onChange={(event) =>
                    updateTeam(team.id, {
                      rescuers: event.target.value === "" ? "" : Number(event.target.value)
                    })
                  }
                  placeholder="מספר מחלצים"
                  disabled={!team.selected}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="panel wizard-panel">
          <h2>סיכום פתיחת אירוע</h2>
          <div className="summary-grid">
            <div>
              <span className="muted">שם האירוע</span>
              <strong>{incidentName || "-"}</strong>
            </div>
            <div>
              <span className="muted">סוג</span>
              <strong>{selectedIncidentTypeLabel}</strong>
            </div>
            <div>
              <span className="muted">עיר</span>
              <strong>{city || "-"}</strong>
            </div>
            <div>
              <span className="muted">כתובת / מיקום</span>
              <strong>{address || "-"}</strong>
            </div>
            <div>
              <span className="muted">מפקד אירוע</span>
              <strong>{incidentCommander || "-"}</strong>
            </div>
            <div>
              <span className="muted">צוותים משויכים</span>
              <strong>{selectedTeamLabels || "לא נבחרו צוותים"}</strong>
            </div>
          </div>
          <div className="actions">
            <button className="button secondary" type="button" onClick={() => setStep(3)}>
              חזרה
            </button>
            <button className="button" type="submit" disabled={!canCreateIncident}>
              צור אירוע
            </button>
          </div>
        </section>
      ) : null}

      <div className="wizard-nav">
        <button
          className="button secondary"
          type="button"
          disabled={step === 1}
          onClick={() => setStep((current) => current - 1)}
        >
          הקודם
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={step === 4}
          onClick={() => setStep((current) => current + 1)}
        >
          הבא
        </button>
      </div>
    </form>
  );
}
