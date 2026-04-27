import { type Transition } from 'framer-motion';

export const standardEase = [0.22, 1, 0.36, 1] as const;

export const quickTransition: Transition = {
  duration: 0.18,
  ease: standardEase,
};

export const pageMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: quickTransition,
};

export const listItemMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: quickTransition,
};

export const pressMotion = {
  whileTap: { scale: 0.98 },
  transition: quickTransition,
};
