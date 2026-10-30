import React, { useEffect, useState } from 'react';
import { useMesh } from '@/context/MeshContext';
import { MeshAppProvider } from '@/context/MeshAppContext';
import { MeshCanvas } from '@/components/common/MeshCanvas';
import { MeshHeader } from '@/components/common/MeshHeader';
import { MeshFooter } from '@/components/common/MeshFooter';
import { MeshHero } from '@/components/landing/MeshHero';
import { MeshStatsBar } from '@/components/landing/MeshStatsBar';
import { MeshKeyFeatures } from '@/components/landing/MeshKeyFeatures';
import { MeshRecyclingVisualizer } from '@/components/landing/MeshRecyclingVisualizer';
import { MeshStrategyTemplatesSection } from '@/components/landing/MeshStrategyTemplatesSection';
import { MeshTriRouteSection } from '@/components/landing/MeshTriRouteSection';
import { MeshYieldSimulator } from '@/components/landing/MeshYieldSimulator';
import { MeshArchitectureBento } from '@/components/landing/MeshArchitectureBento';
import { MeshCovenantVisualizer } from '@/components/landing/MeshCovenantVisualizer';
import { MeshFAQ } from '@/components/landing/MeshFAQ';
import { MeshDocs } from '@/components/docs/MeshDocs';
import { MeshAppShell } from '@/components/app/MeshAppShell';

export function App() {
  const { activeTab, theme } = useMesh();
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const scrollTop = el.scrollTop || document.body.scrollTop;
      const scrollHeight = el.scrollHeight - el.clientHeight;
      setScrollProgress(scrollHeight > 0 ? scrollTop / scrollHeight : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <MeshAppProvider>
      <div className={`min-h-screen flex flex-col transition-colors duration-200 relative ${theme === 'dark' ? 'bg-[#09090b] text-[#fafafa]' : 'bg-[#f9f9fb] text-[#09090b]'}`}>
        {/* Top Scroll Indicator */}
        <div className="fixed top-0 left-0 right-0 h-[2px] z-[100] bg-transparent pointer-events-none">
          <div
            className="h-full bg-neutral-900 dark:bg-white transition-[width] duration-75"
            style={{ width: `${scrollProgress * 100}%` }}
          />
        </div>

        {/* Interactive Mesh Canvas in background */}
        <MeshCanvas />

        {/* Wireframe Header */}
        <MeshHeader />

        {/* Main Body */}
        <main className="flex-1 relative z-10">
          {activeTab === 'landing' && (
            <>
              <MeshHero />
              <MeshStatsBar />
              <MeshKeyFeatures />
              <MeshRecyclingVisualizer />
              <MeshStrategyTemplatesSection />
              <MeshTriRouteSection />
              <MeshYieldSimulator />
              <MeshArchitectureBento />
              <MeshCovenantVisualizer />
              <MeshFAQ />
            </>
          )}
          {activeTab === 'docs' && <MeshDocs />}
          {activeTab === 'app' && <MeshAppShell />}
        </main>

        {/* Wireframe Brutalist Footer */}
        <MeshFooter />
      </div>
    </MeshAppProvider>
  );
}

export default App;
