"use client";

import { FormEvent, useState } from "react";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { askIncidentAssistant, type InvestigationAnswer } from "./actions";

const SUGGESTED_QUESTIONS = [
  "מה השתנה מאז חיתוך מצב קודם?",
  "אילו מספרים מבצעיים שינו סטטוס?",
  "מי עדכן את המספרים המבצעיים האחרונים?",
  "אילו אתרים תרמו הכי הרבה לפער?",
  "אילו צוותים ללא פעילות חדשה?"
];

const CONFIDENCE_LABELS = { high: "ביטחון גבוה", medium: "ביטחון בינוני", low: "ביטחון נמוך" };

export function InvestigationAssistant({ incidentId }: { incidentId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<InvestigationAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setQuestion(trimmed);
    setPending(true);
    setError(null);
    try {
      setResult(await askIncidentAssistant(incidentId, trimmed));
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "לא ניתן להשלים את הבדיקה.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return <div className="investigation-assistant-workspace">
    <section className="panel investigation-question-panel">
      <form onSubmit={submit}>
        <label htmlFor="investigation-question">שאלה לתחקור</label>
        <div className="investigation-question-row">
          <textarea id="investigation-question" className="input" rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="שאל שאלה על האירוע..." maxLength={1200} />
          <OperationalLoadingButton
            className="button"
            type="submit"
            label="שאל"
            loadingLabel="בודק נתונים..."
            isLoading={pending}
            disabled={question.trim().length < 2}
          />
        </div>
      </form>
      <div className="investigation-suggestions" aria-label="שאלות מוצעות">
        {SUGGESTED_QUESTIONS.map((suggestion) => <button className="quick-filter-chip" type="button" key={suggestion} onClick={() => void ask(suggestion)} disabled={pending}>{suggestion}</button>)}
      </div>
    </section>

    {error ? <section className="panel investigation-error"><p className="error">{error}</p></section> : null}

    <section className="investigation-result-layout">
      <article className="panel investigation-answer-panel">
        <div className="command-section-heading"><div><p className="eyebrow">מענה מבוסס נתוני אירוע</p><h2>תשובה</h2></div>{result ? <span className={`command-badge confidence-${result.confidence}`}>{CONFIDENCE_LABELS[result.confidence]}</span> : null}</div>
        {pending ? <p className="muted">טוען ובודק את מקורות האירוע...</p> : result ? <>
          <p className="investigation-answer-text">{result.answer}</p>
          {result.limitations ? <div className="investigation-limitations"><strong>מגבלות</strong><p>{result.limitations}</p></div> : null}
        </> : <div className="empty-state compact-empty-state"><h3>מוכנים לתחקור</h3><p className="muted">הזינו שאלה או בחרו שאלה מוצעת. התשובה תתבסס רק על נתוני האירוע.</p></div>}
      </article>

      <aside className="panel investigation-sources-panel">
        <h2>מקורות</h2>
        {result?.sources.length ? <ol>{result.sources.map((source) => <li key={source.id}><span className={`source-type source-${source.type}`}>{source.type === "timeline" ? "ציר זמן" : source.type === "sitrep" ? "חיתוך מצב" : source.type === "site" ? "אתר" : source.type === "operational_number" ? "מספר מבצעי" : source.type === "personnel" ? "כוח אדם" : "מפה"}</span><strong>{source.label}</strong>{source.timestamp ? <time>{new Date(source.timestamp).toLocaleString("he-IL")}</time> : null}</li>)}</ol> : <p className="muted">מקורות תומכים יוצגו לאחר קבלת תשובה.</p>}
      </aside>
    </section>
  </div>;
}
