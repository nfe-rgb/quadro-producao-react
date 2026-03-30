export function toTimestamp(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function clampInterval(startMs, endMs, rangeStartMs, rangeEndMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const start = Math.max(startMs, rangeStartMs);
  const end = Math.min(endMs, rangeEndMs);
  if (end <= start) return null;
  return [start, end];
}

export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];

  const ordered = intervals
    .filter((interval) => Array.isArray(interval) && interval.length === 2)
    .map(([start, end]) => [Number(start), Number(end)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);

  if (!ordered.length) return [];

  const merged = [ordered[0].slice()];
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const last = merged[merged.length - 1];
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
      continue;
    }
    merged.push(current.slice());
  }

  return merged;
}

export function subtractIntervals(baseIntervals, blockedIntervals) {
  const base = mergeIntervals(baseIntervals);
  const blocked = mergeIntervals(blockedIntervals);
  if (!base.length) return [];
  if (!blocked.length) return base;

  const result = [];

  for (const [baseStart, baseEnd] of base) {
    let segments = [[baseStart, baseEnd]];
    for (const [blockedStart, blockedEnd] of blocked) {
      const nextSegments = [];
      for (const [segmentStart, segmentEnd] of segments) {
        const overlapStart = Math.max(segmentStart, blockedStart);
        const overlapEnd = Math.min(segmentEnd, blockedEnd);
        if (overlapEnd <= overlapStart) {
          nextSegments.push([segmentStart, segmentEnd]);
          continue;
        }
        if (segmentStart < overlapStart) nextSegments.push([segmentStart, overlapStart]);
        if (overlapEnd < segmentEnd) nextSegments.push([overlapEnd, segmentEnd]);
      }
      segments = nextSegments;
      if (!segments.length) break;
    }
    result.push(...segments);
  }

  return mergeIntervals(result);
}

export function intersectIntervals(intervals, windows) {
  const source = mergeIntervals(intervals);
  const range = mergeIntervals(windows);
  if (!source.length || !range.length) return [];

  const intersections = [];
  for (const [sourceStart, sourceEnd] of source) {
    for (const [windowStart, windowEnd] of range) {
      const start = Math.max(sourceStart, windowStart);
      const end = Math.min(sourceEnd, windowEnd);
      if (end > start) intersections.push([start, end]);
    }
  }

  return mergeIntervals(intersections);
}

export function sumIntervals(intervals) {
  return mergeIntervals(intervals).reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
}

export function mapRecordsToIntervals(records, {
  startKey = 'started_at',
  endKey = 'ended_at',
  rangeStartMs,
  rangeEndMs,
  fallbackEndMs,
} = {}) {
  if (!Array.isArray(records)) return [];

  const endFallback = Number.isFinite(fallbackEndMs) ? fallbackEndMs : Date.now();
  return records
    .map((record) => {
      const startMs = toTimestamp(record?.[startKey]);
      const endMs = toTimestamp(record?.[endKey]) ?? endFallback;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return clampInterval(startMs, endMs, rangeStartMs, rangeEndMs);
    })
    .filter(Boolean);
}

export function calculateMachinePeriodMetrics({
  groupsByMachine,
  filterStart,
  filterEnd,
  machines,
  nowMs = Date.now(),
}) {
  if (!filterStart || !filterEnd) {
    return {
      totalProdH: 0,
      totalParadaH: 0,
      totalLowEffH: 0,
      totalSemProgH: 0,
      totalDisponivelH: 0,
      totalMaquinasParadas: 0,
      machineParadaMs: {},
      machineLowEffMs: {},
      machineProdMs: {},
      machineSemProgMs: {},
    };
  }

  const rangeStartMs = filterStart.getTime();
  const rangeEndMs = filterEnd.getTime();
  const clampNowMs = Math.min(nowMs, rangeEndMs);
  const rangeWindow = [[rangeStartMs, rangeEndMs]];

  const machineParadaMs = {};
  const machineLowEffMs = {};
  const machineProdMs = {};
  const machineSemProgMs = {};

  let totalParadaMs = 0;
  let totalLowEffMs = 0;
  let totalProdMs = 0;
  let totalSemProgMs = 0;

  for (const machineId of machines) {
    const groups = Array.isArray(groupsByMachine?.[machineId]) ? groupsByMachine[machineId] : [];

    const sessionIntervals = mergeIntervals(
      groups.flatMap((group) => {
        const sessions = Array.isArray(group?.sessions) && group.sessions.length
          ? group.sessions
          : group?.session
            ? [group.session]
            : group?.ordem?.started_at
              ? [{ started_at: group.ordem.started_at, ended_at: group.ordem.finalized_at || group.ordem.interrupted_at || null }]
              : [];

        return mapRecordsToIntervals(sessions, {
          rangeStartMs,
          rangeEndMs,
          fallbackEndMs: clampNowMs,
        });
      })
    );

    const stopIntervals = mergeIntervals(
      groups.flatMap((group) => mapRecordsToIntervals(group?.stops || [], {
        rangeStartMs,
        rangeEndMs,
        endKey: 'ended_at',
        fallbackEndMs: clampNowMs,
      }))
    );

    const lowEffIntervals = mergeIntervals(
      groups.flatMap((group) => mapRecordsToIntervals(group?.lowEffLogs || [], {
        rangeStartMs,
        rangeEndMs,
        endKey: 'ended_at',
        fallbackEndMs: clampNowMs,
      }))
    );

    const stopInsideSessions = intersectIntervals(stopIntervals, sessionIntervals);
    const lowEffInsideSessions = intersectIntervals(lowEffIntervals, sessionIntervals);
    const paradaIntervals = subtractIntervals(stopInsideSessions, lowEffInsideSessions);
    const lowEffOnlyIntervals = subtractIntervals(lowEffInsideSessions, stopInsideSessions);
    const productiveIntervals = subtractIntervals(sessionIntervals, mergeIntervals([...paradaIntervals, ...lowEffOnlyIntervals]));
    const occupiedIntervals = mergeIntervals([...productiveIntervals, ...paradaIntervals, ...lowEffOnlyIntervals]);
    const semProgramacaoIntervals = subtractIntervals(rangeWindow, occupiedIntervals);

    const paradaMs = sumIntervals(paradaIntervals);
    const lowEffMs = sumIntervals(lowEffOnlyIntervals);
    const productiveMs = sumIntervals(productiveIntervals);
    const semProgMs = sumIntervals(semProgramacaoIntervals);

    machineParadaMs[machineId] = paradaMs;
    machineLowEffMs[machineId] = lowEffMs;
    machineProdMs[machineId] = productiveMs;
    machineSemProgMs[machineId] = semProgMs;

    totalParadaMs += paradaMs;
    totalLowEffMs += lowEffMs;
    totalProdMs += productiveMs;
    totalSemProgMs += semProgMs;
  }

  const totalDisponivelH = ((rangeEndMs - rangeStartMs) * machines.length) / 1000 / 60 / 60;

  return {
    totalProdH: totalProdMs / 1000 / 60 / 60,
    totalParadaH: totalParadaMs / 1000 / 60 / 60,
    totalLowEffH: totalLowEffMs / 1000 / 60 / 60,
    totalSemProgH: totalSemProgMs / 1000 / 60 / 60,
    totalDisponivelH,
    totalMaquinasParadas: machines.filter((machineId) => (machineParadaMs[machineId] || 0) > 0).length,
    machineParadaMs,
    machineLowEffMs,
    machineProdMs,
    machineSemProgMs,
  };
}