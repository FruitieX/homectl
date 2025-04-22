// React Hook to detect user inactivity based on specified events like mouse movements, touch events or key presses
// https://gist.github.com/KristofferEriksson/9f7c3bd928953c3853f7807b3565ec99

import { useEffect, useState } from 'react';

const defaultEvents = [
  'mousemove',
  'mousedown',
  'touchstart',
  'keydown',
  'wheel',
  'resize',
];

interface UseIdleOptions {
  timeout?: number;
  events?: string[];
}

const useIdle = ({
  timeout = 5000,
  events = defaultEvents,
}: UseIdleOptions = {}) => {
  const [isIdle, setIsIdle] = useState<boolean>(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      setIsIdle(false);
      timer = setTimeout(() => setIsIdle(true), timeout);
    };

    // Initialize the timer
    resetTimer();

    // Event handler to reset the timer on user activity
    events.forEach((event) => window.addEventListener(event, resetTimer));

    // Cleanup function
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [timeout, events]);

  return isIdle;
};

export default useIdle;
