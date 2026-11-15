// Mutable, non-React channel between the event director, ships, camera and overlay.
import { Color, Vector3 } from "three";
import type { AbilityId, HazardType } from "@sm/shared";

export type FxKind = HazardType | AbilityId | "repair" | "repair-done" | "explode";

export interface ShipLive {
  pos: Vector3;
  forward: Vector3;
  /** Smoothed route fraction 0..1 actually drawn. */
  frac: number;
  alive: boolean;
}

export const fxBus = {
  queues: new Map<string, FxKind[]>(),
  ships: new Map<string, ShipLive>(),
  shake: 0,
  flashColor: new Color("#ffffff"),
  flash: 0,

  push(shipId: string, kind: FxKind): void {
    let q = this.queues.get(shipId);
    if (!q) {
      q = [];
      this.queues.set(shipId, q);
    }
    q.push(kind);
  },
  drain(shipId: string): FxKind[] | null {
    const q = this.queues.get(shipId);
    if (!q || q.length === 0) return null;
    const out = q.slice();
    q.length = 0;
    return out;
  },
  kickShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  },
  screenFlash(color: string, strength: number): void {
    if (strength >= this.flash * 0.6) this.flashColor.set(color);
    this.flash = Math.min(1, Math.max(this.flash, strength));
  },
  reset(): void {
    this.queues.clear();
    this.ships.clear();
    this.shake = 0;
    this.flash = 0;
  },
};
