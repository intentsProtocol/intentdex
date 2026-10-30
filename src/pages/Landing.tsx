import { Button } from "@/components/ui/button"
import { usePrivy } from "@privy-io/react-auth"
import { useNavigate } from "react-router-dom"
import {
    Gift,
    Mail,
    Shield,
    Sparkles,
    ArrowRight,
    Zap,
    Users,
    Globe,
    AlertCircle,
    Play
} from "lucide-react"
import { motion, useScroll, useTransform } from "framer-motion"
import { useRef, useEffect } from "react"

export default function Landing() {
    const { login, authenticated, ready } = usePrivy()
    const navigate = useNavigate()
    const containerRef = useRef(null)
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"]
    })

    const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"])

    // Redirect to dashboard when authenticated
    useEffect(() => {
        if (ready && authenticated) {
            navigate("/dashboard")
        }
    }, [ready, authenticated, navigate])

    // Check if Privy is configured properly
    const privyAppId = import.meta.env.VITE_PRIVY_APP_ID
    const isPrivyConfigured = privyAppId && privyAppId !== "your-privy-app-id-here"

    const handleGetStarted = () => {
        if (authenticated) {
            navigate("/dashboard")
        } else if (isPrivyConfigured) {
            login()
        } else {
            navigate("/dashboard")
        }
    }

    const fadeInUp = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.6 } }
    }

    const stagger = {
        visible: { transition: { staggerChildren: 0.1 } }
    }

    return (
        <div ref={containerRef} className="min-h-screen bg-black text-white selection:bg-purple-500/30">
            {/* Dynamic Background */}
            <div className="fixed inset-0 z-0">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/40 via-black to-black" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay" />
                <motion.div
                    style={{ y }}
                    className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-purple-600/30 rounded-full blur-[120px]"
                />
                <motion.div
                    style={{ y: useTransform(scrollYProgress, [0, 1], ["0%", "-50%"]) }}
                    className="absolute top-1/2 -left-40 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[100px]"
                />
            </div>

            {/* Header */}
            <motion.header
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl"
            >
                <div className="container mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                            <Gift className="h-6 w-6 text-white" />
                        </div>
                        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                            MoveGiftCards
                        </span>
                    </div>

                    <nav className="hidden md:flex items-center gap-8">
                        {["Features", "How it Works", "Docs"].map((item) => (
                            <a
                                key={item}
                                href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                                className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
                            >
                                {item}
                            </a>
                        ))}
                    </nav>

                    <div className="flex items-center gap-4">
                        <Button
                            onClick={handleGetStarted}
                            className="bg-white text-black hover:bg-gray-200 transition-all font-semibold rounded-full px-6"
                        >
                            Launch App
                        </Button>
                    </div>
                </div>
            </motion.header>

            <main className="relative z-10 pt-32 pb-20">
                {/* Dev Mode Banner */}
                {!isPrivyConfigured && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="container mx-auto px-6 mb-8"
                    >
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-center gap-3 text-yellow-200/90 text-sm backdrop-blur-sm">
                            <AlertCircle className="h-5 w-5 flex-shrink-0" />
                            <p>
                                <strong>Development Mode:</strong> Privy is not configured.
                                <span className="ml-2 opacity-75">Click "Launch App" to preview the dashboard with mocked authentication.</span>
                            </p>
                        </div>
                    </motion.div>
                )}

                {/* Hero Section */}
                <section className="container mx-auto px-6 py-12 md:py-20 text-center">
                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={stagger}
                        className="max-w-4xl mx-auto"
                    >
                        <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8 hover:bg-white/10 transition-colors cursor-default">
                            <Sparkles className="h-4 w-4 text-purple-400" />
                            <span className="text-sm font-medium text-purple-200">Built on Movement Network</span>
                        </motion.div>

                        <motion.h1 variants={fadeInUp} className="text-6xl md:text-8xl font-bold tracking-tight mb-8 leading-tight">
                            Send Crypto Gifts <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 animate-gradient-x">
                                Instantly
                            </span>
                        </motion.h1>

                        <motion.p variants={fadeInUp} className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                            The easiest way to gift MOVE tokens via email, Twitter, or Discord.
                            Recipients claim with their social login—no wallet setup required.
                        </motion.p>

                        <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Button
                                size="lg"
                                onClick={handleGetStarted}
                                className="h-14 px-8 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-lg shadow-lg shadow-purple-500/25 transition-all hover:scale-105"
                            >
                                <Gift className="mr-2 h-5 w-5" />
                                Start Gifting
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                className="h-14 px-8 rounded-full border-white/10 bg-white/5 hover:bg-white/10 text-white text-lg backdrop-blur-sm transition-all"
                                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                            >
                                <Play className="mr-2 h-4 w-4 fill-current" />
                                How it Works
                            </Button>
                        </motion.div>
                    </motion.div>

                    {/* Dashboard Preview */}
                    <motion.div
                        initial={{ opacity: 0, y: 100, rotateX: 20 }}
                        animate={{ opacity: 1, y: 0, rotateX: 0 }}
                        transition={{ duration: 1, delay: 0.4, type: "spring" }}
                        className="mt-20 relative max-w-5xl mx-auto"
                        style={{ perspective: "1000px" }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-600/20 to-transparent blur-3xl -z-10" />
                        <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl p-2 shadow-2xl">
                            <div className="rounded-lg bg-gray-900/50 aspect-[16/9] flex items-center justify-center overflow-hidden relative border border-white/5 group">
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 group-hover:opacity-100 opacity-50 transition-opacity duration-500" />
                                {/* Abstract UI Representation */}
                                <div className="grid grid-cols-12 gap-4 w-3/4 opacity-80 group-hover:scale-105 transition-transform duration-700">
                                    <div className="col-span-4 space-y-3">
                                        <div className="h-32 rounded-lg bg-white/10 animate-pulse" />
                                        <div className="h-12 rounded-lg bg-white/5" />
                                        <div className="h-12 rounded-lg bg-white/5" />
                                    </div>
                                    <div className="col-span-8 space-y-3">
                                        <div className="h-16 rounded-lg bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border border-purple-500/20" />
                                        <div className="h-48 rounded-lg bg-white/5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </section>

                {/* Stats Section */}
                <section className="border-y border-white/5 bg-white/5 backdrop-blur-sm">
                    <div className="container mx-auto px-6 py-12">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                            {[
                                { label: "Total Gifted", value: "$125K+" },
                                { label: "Cards Claimed", value: "1,284" },
                                { label: "Active Cards", value: "567" },
                                { label: "Uptime", value: "99.9%" }
                            ].map((stat, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.1 }}
                                    className="text-center"
                                >
                                    <div className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50 mb-1">
                                        {stat.value}
                                    </div>
                                    <div className="text-sm font-medium text-gray-500 uppercase tracking-widest">{stat.label}</div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Features Grid */}
                <section id="features" className="container mx-auto px-6 py-24">
                    <div className="text-center max-w-2xl mx-auto mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold mb-6">Why MoveGiftCards?</h2>
                        <p className="text-gray-400 text-lg">
                            We've reimagined the crypto gifting experience to be seamless, secure, and beautiful.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Card
                            icon={<Mail className="h-8 w-8 text-purple-400" />}
                            title="Send to Any Email"
                            description="Recipients don't need a wallet. Claim with just an email, Twitter, or Discord account."
                            className="md:col-span-2"
                        />
                        <Card
                            icon={<Shield className="h-8 w-8 text-emerald-400" />}
                            title="Secure & Private"
                            description="Recipient IDs are hashed on-chain. Only the intended recipient can claim."
                        />
                        <Card
                            icon={<Zap className="h-8 w-8 text-yellow-400" />}
                            title="Instant Delivery"
                            description="Cards created on-chain instantly. Zero downtime."
                        />
                        <Card
                            icon={<Globe className="h-8 w-8 text-blue-400" />}
                            title="Multiple Tokens"
                            description="Send MOVE, USDC, or USDT with auto-conversion."
                        />
                        <Card
                            icon={<Users className="h-8 w-8 text-pink-400" />}
                            title="Bulk Sending"
                            description="Perfect for team rewards, airdrops, and community events."
                        />
                    </div>
                </section>

                {/* How It Works */}
                <section id="how-it-works" className="container mx-auto px-6 py-24 border-t border-white/5">
                    <h2 className="text-3xl md:text-5xl font-bold text-center mb-16">How It Works</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
                        {/* Connecting Line (Desktop) */}
                        <div className="hidden md:block absolute top-12 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500/0 via-purple-500/50 to-purple-500/0" />

                        {[
                            { step: 1, title: "Connect", desc: "Sign in with social login via Privy" },
                            { step: 2, title: "Create", desc: "Choose token, amount & style" },
                            { step: 3, title: "Send", desc: "Enter email or social handle" },
                            { step: 4, title: "Claim", desc: "Recipient logs in to claim!" }
                        ].map((item) => (
                            <div key={item.step} className="relative group">
                                <div className="w-24 h-24 mx-auto bg-black border border-purple-500/30 rounded-full flex items-center justify-center mb-6 relative z-10 shadow-[0_0_30px_rgba(168,85,247,0.15)] group-hover:scale-110 group-hover:border-purple-500 transition-all duration-300">
                                    <span className="text-3xl font-bold text-white">{item.step}</span>
                                </div>
                                <div className="text-center">
                                    <h3 className="text-xl font-bold mb-2 group-hover:text-purple-400 transition-colors">{item.title}</h3>
                                    <p className="text-sm text-gray-400">{item.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CTA */}
                <section className="container mx-auto px-6 py-24 text-center">
                    <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-purple-900/50 to-indigo-900/50 border border-white/10 p-12 md:p-24">
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay" />
                        <div className="relative z-10">
                            <h2 className="text-4xl md:text-5xl font-bold mb-6">Ready to Send Your First Gift?</h2>
                            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
                                Join thousands of users spreading crypto joy with MoveGiftCards.
                            </p>
                            <Button
                                size="lg"
                                onClick={handleGetStarted}
                                className="h-14 px-10 rounded-full bg-white text-black hover:bg-gray-100 text-lg font-bold shadow-2xl transition-all hover:scale-105"
                            >
                                Get Started Now
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                </section>

                {/* Footer */}
                <footer className="border-t border-white/10 bg-black/50 backdrop-blur-xl py-12">
                    <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
                            <Gift className="h-5 w-5 text-purple-500" />
                            <span className="font-bold">MoveGiftCards</span>
                        </div>
                        <div className="flex gap-8 text-sm text-gray-400">
                            {["Twitter", "Discord", "GitHub", "Docs"].map(link => (
                                <a key={link} href="#" className="hover:text-white transition-colors">{link}</a>
                            ))}
                        </div>
                        <div className="text-xs text-gray-600">
                            © 2026 MoveGiftCards. Built on Movement.
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    )
}

function Card({ icon, title, description, className = "" }: { icon: React.ReactNode, title: string, description: string, className?: string }) {
    return (
        <motion.div
            whileHover={{ y: -5 }}
            className={`p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/30 transition-all cursor-default group ${className}`}
        >
            <div className="mb-6 p-4 rounded-xl bg-black/40 w-fit border border-white/5 group-hover:scale-110 transition-transform duration-300">
                {icon}
            </div>
            <h3 className="text-xl font-bold mb-3 text-white group-hover:text-purple-300 transition-colors">{title}</h3>
            <p className="text-gray-400 leading-relaxed">
                {description}
            </p>
        </motion.div>
    )
}
