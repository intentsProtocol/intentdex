import { useEffect, useState } from 'react';
import { useChamTheme } from '@/context/ChamThemeContext';

export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);
  const { activeColor } = useChamTheme();

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const scrollTop = el.scrollTop || document.body.scrollTop;
      const scrollHeight = el.scrollHeight - el.clientHeight;
      setProgress(scrollHeight > 0 ? scrollTop / scrollHeight : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 h-[2px] z-[100] bg-transparent pointer-events-none">
      <div
        className="h-full transition-[width] duration-75"
        style={{
          width: `${progress * 100}%`,
          background: `linear-gradient(to right, ${activeColor.hex}, #38bdf8, #a78bfa)`,
          boxShadow: `0 0 10px ${activeColor.hex}`,
        }}
      />
    </div>
  );
}
