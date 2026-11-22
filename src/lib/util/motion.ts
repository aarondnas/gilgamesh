// Animations step aside for users who asked their system to reduce motion.

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Whether the user asked to reduce motion; read anew each time, so a change applies at once. */
export const prefersReducedMotion = (): boolean => reduce.matches;

/** An animation's duration: `ms`, or 0 where motion is reduced. */
export const motionMs = (ms: number): number => (reduce.matches ? 0 : ms);
