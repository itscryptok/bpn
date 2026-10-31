// 7 colorful person-icon variations. Randomly assigned server-side per comment.
// No real names or photos are ever shown with comments — only these icons + "member".
const VARIANTS = [
  { bg: '#f2b705', skin: '#8d5524', hair: 'bun', hairColor: '#1f2937' },
  { bg: '#0e7a6b', skin: '#ffdbac', hair: 'short', hairColor: '#b7791f' },
  { bg: '#e0526e', skin: '#5c3a21', hair: 'afro', hairColor: '#111827' },
  { bg: '#7a3fa0', skin: '#f1c27d', hair: 'long', hairColor: '#7c2d12' },
  { bg: '#0b5fa5', skin: '#a0663a', hair: 'bald', hairColor: null },
  { bg: '#15803d', skin: '#ffdbac', hair: 'cap', hairColor: '#dc2626' },
  { bg: '#c2570b', skin: '#8d5524', hair: 'glasses', hairColor: '#111827' }
];

function Hair({ kind, color }) {
  if (kind === 'bun') return (<><circle cx="32" cy="20" r="13" fill={color} /><circle cx="32" cy="7" r="5" fill={color} /></>);
  if (kind === 'short') return <path d="M19 22 Q19 8 32 8 Q45 8 45 22 Q42 13 32 13 Q22 13 19 22" fill={color} />;
  if (kind === 'afro') return <circle cx="32" cy="18" r="17" fill={color} />;
  if (kind === 'long') return <path d="M17 30 Q14 8 32 8 Q50 8 47 30 L44 44 L38 30 Q38 16 32 16 Q26 16 26 30 L20 44 Z" fill={color} />;
  if (kind === 'cap') return (<><path d="M18 20 Q18 7 32 7 Q46 7 46 20 L46 17 L18 17 Z" fill={color} /><rect x="44" y="16" width="10" height="4" rx="2" fill={color} /></>);
  if (kind === 'glasses') return (<><path d="M19 21 Q19 9 32 9 Q45 9 45 21 Q42 13 32 13 Q22 13 19 21" fill={color} /><circle cx="25" cy="24" r="4" fill="none" stroke="#111827" strokeWidth="1.6" /><circle cx="39" cy="24" r="4" fill="none" stroke="#111827" strokeWidth="1.6" /><line x1="29" y1="24" x2="35" y2="24" stroke="#111827" strokeWidth="1.6" /></>);
  return null;
}

export function PersonIcon({ variant = 1, size = 48 }) {
  const v = VARIANTS[((variant - 1) % 7 + 7) % 7];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="member icon" role="img">
      <circle cx="32" cy="32" r="31" fill={v.bg} />
      <circle cx="32" cy="52" r="16" fill={v.skin} clipPath="url(#clip)" />
      <clipPath id="clip"><circle cx="32" cy="32" r="31" /></clipPath>
      <path d="M16 62 Q16 44 32 44 Q48 44 48 62 Z" fill={v.skin} />
      <circle cx="32" cy="27" r="11" fill={v.skin} />
      {v.hairColor && <Hair kind={v.hair} color={v.hairColor} />}
    </svg>
  );
}
