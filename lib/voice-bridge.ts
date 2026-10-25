type VoicePart = { type: "delta"; text: string } | { type: "done" };
type Pending = (part: VoicePart) => void;
type Session = { queued: VoicePart[]; pending: Pending[]; transcripts: string[]; transcriptPending: Array<(text: string | null) => void>; userTurnCount: number };

const bridgeGlobal = globalThis as typeof globalThis & { __voiceBridgeSessions?: Map<string, Session> };
const sessions = bridgeGlobal.__voiceBridgeSessions ??= new Map<string, Session>();
const SESSION_ID = /^[0-9a-f-]{36}$/i;

function session(id: string): Session {
  if (!SESSION_ID.test(id)) throw new Error("Invalid voice session");
  let entry = sessions.get(id);
  if (!entry) {
    entry = { queued: [], pending: [], transcripts: [], transcriptPending: [], userTurnCount: 0 };
    sessions.set(id, entry);
  }
  return entry;
}

export function publishVoicePart(id: string, part: VoicePart): void {
  const entry = session(id);
  const waiting = entry.pending.shift();
  if (waiting) waiting(part);
  else entry.queued.push(part);
}

export function nextVoicePart(id: string): Promise<VoicePart> {
  const entry = session(id);
  const queued = entry.queued.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    entry.pending.push(resolve);
    setTimeout(() => {
      const index = entry.pending.indexOf(resolve);
      if (index >= 0) {
        entry.pending.splice(index, 1);
        reject(new Error("Interview reply timed out"));
      }
    }, 120_000);
  });
}

export function publishVoiceTranscript(id: string, text: string, userTurnCount: number): void {
  const entry = session(id);
  if (userTurnCount <= entry.userTurnCount) return;
  entry.userTurnCount = userTurnCount;
  const waiting = entry.transcriptPending.shift();
  if (waiting) waiting(text);
  else entry.transcripts.push(text);
}

export function nextVoiceTranscript(id: string): Promise<string | null> {
  const entry = session(id);
  const queued = entry.transcripts.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    entry.transcriptPending.push(resolve);
    setTimeout(() => {
      const index = entry.transcriptPending.indexOf(resolve);
      if (index >= 0) {
        entry.transcriptPending.splice(index, 1);
        resolve(null);
      }
    }, 15_000);
  });
}
