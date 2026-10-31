import { useState, useEffect } from 'react';
import { ScrollProgressBar } from '@/components/common/ScrollProgressBar';
import { Header } from '@/components/common/Header';
import { Footer } from '@/components/common/Footer';
import { WalletHero } from '@/components/wallet/WalletHero';
import { WalletBentoOverview } from '@/components/wallet/WalletBentoOverview';
import { WalletLocalAISection } from '@/components/wallet/WalletLocalAISection';
import { WalletChainsArc } from '@/components/wallet/WalletChainsArc';
import { WalletFeaturesBento } from '@/components/wallet/WalletFeaturesBento';
import { WalletSecuritySection } from '@/components/wallet/WalletSecuritySection';
import { WalletFAQ } from '@/components/wallet/WalletFAQ';
import { WalletDownloadBanner } from '@/components/wallet/WalletDownloadBanner';
import { WalletDownloadModal } from '@/components/wallet/WalletDownloadModal';
import { PitchDeck } from '@/components/pitch/PitchDeck';

const checkIsPitchRoute = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return path === '/pitch' || path.startsWith('/pitch') || hash === '#/pitch' || hash === '#pitch';
};

export function App() {
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [isPitch, setIsPitch] = useState(() => checkIsPitchRoute());

  useEffect(() => {
    const onLocationChange = () => {
      setIsPitch(checkIsPitchRoute());
    };
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  if (isPitch) {
    return <PitchDeck />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#050505] text-foreground selection:bg-emerald-500/30 selection:text-white">
      {/* Top Scroll Progress Neon Bar */}
      <ScrollProgressBar />

      {/* Global Header */}
      <Header onOpenDownload={() => setDownloadModalOpen(true)} />

      {/* Main Page Content */}
      <main className="flex-1">
        {/* Section 1: Hero with 3D Phone & Cham Mascot */}
        <WalletHero onOpenDownload={() => setDownloadModalOpen(true)} />

        {/* Section 2: Bento Grid Overview */}
        <WalletBentoOverview />

        {/* Section 3: The Flight Mode Breakthrough & On-Device Local AI */}
        <WalletLocalAISection />

        {/* Section 4: Interactive Multi-Chain Floating Orbs & Camouflage Arena */}
        <WalletChainsArc />

        {/* Section 5: Comprehensive Features Matrix */}
        <WalletFeaturesBento />

        {/* Section 6: Institutional-Grade Security & Cryptography */}
        <WalletSecuritySection />

        {/* Section 7: Interactive FAQ Accordion */}
        <WalletFAQ />

        {/* Section 8: Final Conversion Download Banner */}
        <WalletDownloadBanner onOpenDownload={() => setDownloadModalOpen(true)} />
      </main>

      {/* Global Footer */}
      <Footer />

      {/* Platform Download Dialog Modal */}
      <WalletDownloadModal
        isOpen={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
      />
    </div>
  );
}

export default App;
