interface LogoProps {
  className?: string;
}

/** ALFA Traineon brand mark. Two interlocking speech-bubble forms in the
 *  indigo brand palette. Size via `className` (e.g. `size-8`). */
export function Logo({ className }: LogoProps) {
  return (
    <svg viewBox="8.75 22.5 81.5 81.5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="ALFA Traineon Logo" transform="matrix(-1,0,0,1,0,0)" className={className}>
      {/*  Bottom Shape (Light Blue) */}
      <path d="M 67 59 A 15 15 0 0 1 67 89 L 29 89 A 15 15 0 0 0 14 104 L 14 74 A 15 15 0 0 1 29 59 Z" fill="#a5b4fc" />

      {/*  Top Shape (Dark Blue) */}
      <path d=" M 30 53.5 A 15 15 0 0 1 30 22.5 L 70 22.5 A 15 15 0 0 1 85 37.5 L 85 63.5 A 15 15 0 0 0 70 53.5 L 30 53.5 Z" fill="#6366f1" />
    </svg>
  );
}
