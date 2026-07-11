export type ZoneAvailability = {
  code: string;
  count: number;
};

export type ZoneSelection = {
  code?: string;
  resetTriedZones: boolean;
};

export type NextZoneResult = {
  zone?: string;
  cycled: boolean;
};

export class ZoneSelector {
  nextZoneAfter(currentZone: string | undefined, zonePriority: string[], triedZones: Set<string> = new Set()): NextZoneResult {
    if (zonePriority.length === 0) return { cycled: false };

    const currentIndex = currentZone ? zonePriority.indexOf(currentZone) : -1;
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    const orderedZones = [
      ...zonePriority.slice(startIndex),
      ...zonePriority.slice(0, startIndex),
    ];

    const fresh = orderedZones.find((zone) => !triedZones.has(zone));
    if (fresh) return { zone: fresh, cycled: false };
    // all zones tried: cycle back — competitors may release seats they held
    return { zone: orderedZones[0], cycled: true };
  }

  orderAvailableZones(
    zones: ZoneAvailability[],
    priority: string[],
    triedZones: Set<string> = new Set(),
  ): ZoneAvailability[] {
    const available = zones.filter((zone) => zone.count > 0 && !triedZones.has(zone.code));
    const ordered: ZoneAvailability[] = [];
    const seen = new Set<string>();

    for (const preferred of priority) {
      for (const zone of available) {
        if ((zone.code === preferred || zone.code.startsWith(preferred)) && !seen.has(zone.code)) {
          ordered.push(zone);
          seen.add(zone.code);
        }
      }
    }

    for (const zone of available) {
      if (!seen.has(zone.code)) ordered.push(zone);
    }

    return ordered;
  }

  selectNextAvailableZone(
    zones: ZoneAvailability[],
    priority: string[],
    triedZones: Set<string> = new Set(),
  ): ZoneSelection {
    const ordered = this.orderAvailableZones(zones, priority, triedZones);
    if (ordered[0]) return { code: ordered[0].code, resetTriedZones: false };

    if (!zones.some((zone) => zone.count > 0)) return { resetTriedZones: false };

    const restarted = this.orderAvailableZones(zones, priority, new Set());
    return {
      code: restarted[0]?.code,
      resetTriedZones: true,
    };
  }
}

const DEFAULT_ZONE_SELECTOR = new ZoneSelector();

export function nextZoneAfter(currentZone: string | undefined, zonePriority: string[], triedZones: Set<string> = new Set()): NextZoneResult {
  return DEFAULT_ZONE_SELECTOR.nextZoneAfter(currentZone, zonePriority, triedZones);
}

export function orderAvailableZones(
  zones: ZoneAvailability[],
  priority: string[],
  triedZones: Set<string> = new Set(),
): ZoneAvailability[] {
  return DEFAULT_ZONE_SELECTOR.orderAvailableZones(zones, priority, triedZones);
}

export function selectNextAvailableZone(
  zones: ZoneAvailability[],
  priority: string[],
  triedZones: Set<string> = new Set(),
): ZoneSelection {
  return DEFAULT_ZONE_SELECTOR.selectNextAvailableZone(zones, priority, triedZones);
}
