/** Agent identity mark: a minimal bot face, deterministic per agent.
 *  Idle agents look at you with two eyes; while executing, the eyes become three pulsing
 *  "thinking" dots. Attention states add a small corner marker. The mark is decorative —
 *  every place that shows it also states the status in text. */

export const AGENT_COLORS = ["#C65D32", "#4776A8", "#27845A", "#7A5BA6", "#9A6417", "#2F7F86", "#A04F6B", "#5B615C"];
export const FACE_COUNT = 6;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function faceIndex(seed: string, icon?: string): number {
  if (icon && /^face-\d$/.test(icon)) return Number(icon.slice(5)) % FACE_COUNT;
  return hash(seed || "agent") % FACE_COUNT;
}

const CORNER: Record<string, string> = { waiting_for_approval: "#9A6417", failed: "#C44848", queued: "#8D928D" };

export function BotMark({ seed, avatar, size = 28, state, title }: {
  seed: string; avatar?: { icon?: string; color?: string }; size?: number; state?: string; title?: string;
}) {
  const color = avatar?.color && /^#[0-9a-fA-F]{6}$/.test(avatar.color) ? avatar.color : AGENT_COLORS[hash(seed) % AGENT_COLORS.length];
  const off = state === "disabled" || state === "draft";
  const c = off ? "#8D928D" : color;
  const face = faceIndex(seed, avatar?.icon);
  const working = state === "running";
  const eyeGap = [4, 5, 4, 5, 4, 4][face];
  const ex = [14 - eyeGap, 14 + eyeGap];
  const eyes = () => {
    switch (face) {
      case 0: return ex.map((x) => <circle key={x} cx={x} cy={15} r={1.8} fill={c} />);
      case 1: return ex.map((x) => <circle key={x} cx={x} cy={15} r={2.4} fill={c} />);
      case 2: return ex.map((x) => <rect key={x} x={x - 2.4} y={13.9} width={4.8} height={2.2} rx={1.1} fill={c} />);
      case 3: return ex.map((x) => <rect key={x} x={x - 1.9} y={13.1} width={3.8} height={3.8} rx={1} fill={c} />);
      case 4: return ex.map((x) => <rect key={x} x={x - 1.2} y={12.6} width={2.4} height={4.8} rx={1.2} fill={c} />);
      default: return ex.map((x) => <circle key={x} cx={x} cy={15} r={2} fill="none" stroke={c} strokeWidth={1.6} />);
    }
  };
  return (
    <svg className="bot" width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={title ?? "Agent"}>
      {face % 2 === 1 && (
        <g stroke={c} strokeWidth={1.4} strokeLinecap="round">
          <line x1={14} y1={4.5} x2={14} y2={2.4} />
          <circle cx={14} cy={1.9} r={1.1} fill={c} stroke="none" />
        </g>
      )}
      <rect x={2.5} y={4.5} width={23} height={20.5} rx={7} fill={`${c}1A`} stroke={`${c}59`} strokeWidth={1} />
      {working ? (
        [9, 14, 19].map((x, i) => (
          <circle key={x} cx={x} cy={15} r={1.7} fill={c} className="bot-dot" style={{ animationDelay: `${i * 0.15}s` }} />
        ))
      ) : eyes()}
      {state && CORNER[state] && <circle cx={24} cy={6} r={3.2} fill={CORNER[state]} stroke="#fff" strokeWidth={1.5} />}
    </svg>
  );
}
