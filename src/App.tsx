import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppShell } from "./components/layout/AppShell"
import Landing from "./pages/Landing"
import Dashboard from "./pages/Dashboard"
import Send from "./pages/Send"
import Claim from "./pages/Claim"
import ClaimGift from "./pages/ClaimGift"
import History from "./pages/History"
import Bridge from "./pages/Bridge"
import Explore from "./pages/Explore"
import { Toaster } from "@/components/ui/sonner"
import { usePrivy } from "@privy-io/react-auth"

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { authenticated, ready } = usePrivy()

  // For development/testing: Check if we're in dev mode without valid Privy
  const isDevMode = import.meta.env.DEV

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center mesh-gradient">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // In dev mode, allow access even if not authenticated (for testing UI)
  if (!authenticated && !isDevMode) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<Landing />} />

        {/* Protected routes with AppShell layout (accessible in dev mode) */}
        <Route element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/send" element={<Send />} />
          <Route path="/claim" element={<Claim />} />
          <Route path="/claim/redeem" element={<ClaimGift />} />
          <Route path="/history" element={<History />} />
          <Route path="/bridge" element={<Bridge />} />
          <Route path="/explore" element={<Explore />} />
        </Route>
      </Routes>
      <Toaster position="top-right" />
    </BrowserRouter>
  )
}

export default App
