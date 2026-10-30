import { Outlet, Link, useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { usePrivy } from "@privy-io/react-auth"
import { useTranslation } from "react-i18next"
import { Moon, Sun, Languages, Gift, LayoutDashboard, Send, Download, History, LogOut, Menu, ArrowLeftRight, Compass } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/send", label: "Send Gift", icon: Send },
    { href: "/claim", label: "Claim", icon: Download },
    { href: "/history", label: "History", icon: History },
    { href: "/bridge", label: "Bridge", icon: ArrowLeftRight },
    { href: "/explore", label: "Explore", icon: Compass },
]

export function AppShell() {
    const { logout, user } = usePrivy()
    const { i18n } = useTranslation()
    const { theme, setTheme } = useTheme()
    const location = useLocation()

    const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")
    const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'en' ? 'zh' : 'en')
    const navigate = useNavigate()

    const handleLogout = async () => {
        await logout()
        navigate("/")
    }

    const NavLinks = ({ onClick }: { onClick?: () => void }) => (
        <>
            {navItems.map((item) => (
                <Link
                    key={item.href}
                    to={item.href}
                    onClick={onClick}
                    className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200",
                        location.pathname === item.href
                            ? "bg-purple-500/10 text-purple-400 font-medium border border-purple-500/20"
                            : "text-gray-400 hover:text-white hover:bg-white/5"
                    )}
                >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                </Link>
            ))}
        </>
    )

    return (
        <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
            {/* Fixed Background Layer */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-black to-black" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay" />
            </div>

            {/* Desktop Sidebar */}
            <aside className="hidden md:flex fixed left-0 top-0 h-screen w-64 flex-col border-r border-white/10 bg-black/50 backdrop-blur-xl p-4 z-20">
                <Link to="/dashboard" className="flex items-center gap-2 px-2 mb-8 group">
                    <div className="p-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 group-hover:scale-105 transition-transform duration-300 shadow-lg shadow-purple-500/20">
                        <Gift className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                        MoveGiftCards
                    </span>
                </Link>

                <nav className="flex-1 space-y-1">
                    <NavLinks />
                </nav>

                <div className="border-t border-white/10 pt-4 space-y-2">
                    <div className="px-2 py-2 text-sm text-gray-500 truncate font-mono bg-white/5 rounded-lg mb-2">
                        {user?.email?.address || user?.twitter?.username || "Connected"}
                    </div>
                    <div className="flex items-center justify-between px-2">
                        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-gray-400 hover:text-white hover:bg-white/10">
                            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={toggleLanguage} className="text-gray-400 hover:text-white hover:bg-white/10">
                            <Languages className="h-5 w-5" />
                        </Button>
                    </div>
                    <Button variant="ghost" className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={handleLogout}>
                        <LogOut className="mr-2 h-5 w-5" /> Logout
                    </Button>
                </div>
            </aside>

            {/* Mobile Header */}
            <header className="md:hidden sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-black/50 backdrop-blur-xl p-4">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10"><Menu className="h-6 w-6" /></Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-64 p-4 bg-black/90 border-r border-white/10 text-white">
                        <Link to="/dashboard" className="flex items-center gap-2 mb-8">
                            <div className="p-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600">
                                <Gift className="h-5 w-5 text-white" />
                            </div>
                            <span className="text-xl font-bold">MoveGiftCards</span>
                        </Link>
                        <nav className="space-y-1"><NavLinks /></nav>
                        <div className="border-t border-white/10 pt-4 mt-8">
                            <Button variant="ghost" className="w-full justify-start text-red-400 hover:bg-red-500/10" onClick={handleLogout}>
                                <LogOut className="mr-2 h-5 w-5" /> Logout
                            </Button>
                        </div>
                    </SheetContent>
                </Sheet>

                <Link to="/dashboard" className="flex items-center gap-2">
                    <Gift className="h-6 w-6 text-purple-500" />
                    <span className="font-bold text-white">MoveGiftCards</span>
                </Link>

                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-white hover:bg-white/10">
                        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                    </Button>
                </div>
            </header>

            {/* Main Content */}
            <main className="md:ml-64 min-h-screen relative z-10">
                <div className="container mx-auto p-4 md:p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    )
}
