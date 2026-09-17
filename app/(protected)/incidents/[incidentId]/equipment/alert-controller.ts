import { equipmentTiming, estimateServerTime } from "./equipment-model";
import { presentationKey, reconcilePresentations, sortPresentations, type AlertClaim, type AlertResult,
  type AlertSnapshot, type Delivery, type Presentation, type Severity } from "./alert-model";

type Api = { sync(): Promise<AlertResult<AlertSnapshot>>; claim(token: string): Promise<AlertResult<AlertClaim>>;
  ack(id: string, token: string): Promise<AlertResult<Delivery>>; dismiss(id: string, token: string): Promise<AlertResult<Delivery>> };
export type AlertView = { queue: Presentation[]; serverTime: number | null; error: string | null; ready: boolean };
// All network operations share one serial queue. Repeated invalidations coalesce.
// Tokens and due dates belong to the database; local time only hides expired UI.
export class EquipmentAlertController {
  private queue: Presentation[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private syncing = false;
  private dirty = false;
  private live = true;
  private visible = true;
  private ready = false;
  private error: string | null = null;
  private anchor: { server: string; mono: number } | null = null;
  private sounded = new Set<string>();
  constructor(private incidentId: string, private api: Api, private emit: (view: AlertView) => void,
    private sound: (severity: Severity) => void, private monotonic: () => number, private token: () => string) {}
  private now() { return this.anchor ? estimateServerTime(this.anchor.server, this.anchor.mono, this.monotonic()) : null; }
  private publish() { if (this.live) this.emit({ queue: this.visible && this.ready ? sortPresentations(this.queue) : [], serverTime: this.now(), error: this.error, ready: this.ready }); }
  private enqueue<T>(work: () => Promise<T>) {
    const result = this.chain.then(work);
    this.chain = result.catch(() => undefined);
    return result;
  }
  private setClock(server: string) { this.anchor = { server, mono: this.monotonic() }; }
  requestSync(): Promise<unknown> {
    if (!this.live || !this.visible) return this.chain;
    this.dirty = true;
    if (this.syncing) return this.chain;
    this.syncing = true;
    return this.enqueue(async () => {
      try {
        while (this.dirty && this.live && this.visible) {
          this.dirty = false;
          const result = await this.api.sync();
          if (!this.live) return;
          if (result.ok === false) {
            this.error = result.message; this.ready = false;
            if (result.stopped) this.queue = [];
            this.publish(); break;
          }
          const state = result.data;
          if (!Array.isArray(state.alerts) || !Array.isArray(state.presentations) || !Number.isFinite(Date.parse(state.server_now))) {
            throw new Error("Invalid alert snapshot");
          }
          // Defense in depth in addition to server scope and RLS.
          state.alerts = state.alerts.filter((a) => a.incident_id === this.incidentId);
          this.setClock(state.server_now);
          this.queue = reconcilePresentations(this.queue, state);
          const claimToken = this.token();
          const claim = await this.api.claim(claimToken);
          if (!this.live) return;
          if (claim.ok === false) { this.error = claim.message; this.ready = false; this.publish(); break; }
          if (!Array.isArray(claim.data.alerts) || !Number.isFinite(Date.parse(claim.data.server_now))) throw new Error("Invalid claim");
          this.setClock(claim.data.server_now);
          for (const alert of claim.data.alerts) {
            if (alert.incident_id !== this.incidentId || alert.presentation_token !== claimToken
              || !Number.isFinite(Date.parse(alert.lease_until)) || Date.parse(alert.lease_until) <= this.now()!) continue;
            // Do not replace a still displayed presentation by a duplicate row.
            this.queue = this.queue.filter((row) => row.alert.alert_id !== alert.alert_id);
            this.queue.push({ alert, token: alert.presentation_token, expiresAt: Date.parse(alert.lease_until), acknowledged: false, claimedSeverity: alert.claimed_severity });
          }
          this.error = null; this.ready = true; this.publish();
        }
      } catch { this.ready = false; this.error = "סנכרון ההתרעות נותק. ממתין לחיבור מחדש."; this.publish(); }
      finally { this.syncing = false; }
    });
  }
  // Called from an effect only AFTER the dialog has actually been rendered.
  presented(key: string) {
    return this.enqueue(async () => {
      const row = this.queue.find((p) => presentationKey(p) === key);
      if (!this.live || !this.visible || !this.ready || !row || row.acknowledged || row.expiresAt <= this.now()!) return;
      try {
        const result = await this.api.ack(row.alert.alert_id, row.token);
        if (!this.live) return;
        if (result.ok === false) {
          this.queue = this.queue.filter((p) => presentationKey(p) !== key);
          this.error = result.message; this.publish(); void this.requestSync(); return;
        }
        row.acknowledged = true;
        row.expiresAt = Date.parse(result.data.next_due_at ?? "");
        if (!Number.isFinite(row.expiresAt)) { this.queue = this.queue.filter((p) => p !== row); this.publish(); return; }
        if (this.visible && !this.sounded.has(key)) {
          this.sounded.add(key);
          try { this.sound(row.alert.severity); } catch { /* Visual delivery is independent of audio. */ }
        }
        this.publish();
        if (row.alert.severity !== row.claimedSeverity) void this.requestSync();
      } catch { this.ready = false; this.error = "לא התקבל אישור הצגה. מסנכרן מחדש."; this.publish(); void this.requestSync(); }
    });
  }
  dismiss(key: string) {
    return this.enqueue(async () => {
      const row = this.queue.find((p) => presentationKey(p) === key);
      if (!this.live || !row) return;
      try {
        const result = await this.api.dismiss(row.alert.alert_id, row.token);
        if (!this.live) return;
        if (result.ok === true) { this.queue = this.queue.filter((p) => presentationKey(p) !== key); this.error = null; }
        else { this.error = result.message; if (result.stopped) this.queue = this.queue.filter((p) => presentationKey(p) !== key); }
        this.publish(); void this.requestSync();
      } catch { this.error = "הדחייה לא אושרה. יש לנסות שוב."; this.publish(); }
    });
  }
  tick() {
    if (!this.live || !this.visible || !this.ready || this.now() === null) return;
    const before = this.queue.length;
    this.queue = this.queue.filter((p) => p.expiresAt > this.now()!
      && !(p.acknowledged && p.claimedSeverity === "warning" && equipmentTiming(p.alert, this.now()!).remaining <= 0));
    this.publish();
    if (this.queue.length !== before) void this.requestSync();
  }
  suspend() { this.visible = false; this.ready = false; this.publish(); }
  resume() { this.visible = true; this.ready = false; this.publish(); return this.requestSync(); }
  disconnect() { this.ready = false; this.error = "חיבור העדכונים נותק. הסנכרון המחזורי ינסה להשלים את המידע."; this.publish(); }
  stop() { this.live = false; this.queue = []; this.dirty = false; this.sounded.clear(); }
}
