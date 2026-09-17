export type AudioStatus = "required" | "enabled" | "blocked";
// Audio permission is session-local even if the user's preference was saved.
export class EquipmentAlertAudio {
  private context: AudioContext | null = null;
  private closed = false;
  constructor(private changed: (status: AudioStatus) => void, private create = () => new AudioContext()) {}
  async enable() {
    try {
      this.context ??= this.create(); // Called directly from a user gesture.
      this.context.onstatechange = () => {
        if (!this.closed) this.changed(this.context?.state === "running" ? "enabled" : "blocked");
      };
      await this.context.resume();
      if (this.closed) return;
      if (this.context.state !== "running") throw new Error("Audio blocked");
      try { localStorage.setItem("equipment-alert-audio-preferred", "true"); } catch { /* storage optional */ }
      this.changed("enabled");
    } catch { if (!this.closed) this.changed("blocked"); }
  }
  play(severity: "warning" | "critical") {
    if (this.closed) return;
    if (!this.context) { this.changed("required"); return; }
    if (this.context.state !== "running") { this.changed("blocked"); return; }
    try {
      const count = severity === "critical" ? 3 : 1;
      for (let index = 0; index < count; index++) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const start = this.context.currentTime + index * 0.3;
        oscillator.frequency.value = severity === "critical" ? 880 : 660;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.14, start + 0.02);
        gain.gain.linearRampToValueAtTime(0, start + 0.2);
        oscillator.connect(gain); gain.connect(this.context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + 0.22);
      }
    } catch { this.changed("blocked"); }
  }
  close() { this.closed = true; void this.context?.close().catch(() => undefined); }
}
