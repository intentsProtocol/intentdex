import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { ArrowLeftRight, Copy, Check, ExternalLink, RefreshCw, Wallet, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { toast } from "sonner"
import { getDepositAddress, getRelayerHealth, type DepositAddressResponse } from "@/lib/bridgeApi"
import { QRCodeSVG } from "qrcode.react"

export default function Bridge() {
    const { user } = usePrivy()
    const [loading, setLoading] = useState(false)
    const [relayerOnline, setRelayerOnline] = useState(false)
    const [depositData, setDepositData] = useState<DepositAddressResponse | null>(null)
    const [copied, setCopied] = useState(false)

    // Find Movement Wallet
    const movementWallet = user?.linkedAccounts.find(
        (account) => account.type === 'wallet' && account.chainType === 'aptos'
    ) as WalletWithMetadata | undefined;

    const userAddress = movementWallet?.address;

    useEffect(() => {
        checkHealth()
        if (userAddress) {
            fetchDepositAddress()
        }
    }, [userAddress])

    const checkHealth = async () => {
        const isOnline = await getRelayerHealth()
        setRelayerOnline(isOnline)
    }

    const fetchDepositAddress = async () => {
        if (!userAddress) return
        setLoading(true)
        const data = await getDepositAddress(userAddress)
        if (data) {
            setDepositData(data)
        } else {
            toast.error("Failed to generate deposit address. Is the relayer running?")
        }
        setLoading(false)
    }

    const copyToClipboard = () => {
        if (depositData?.depositAddress) {
            navigator.clipboard.writeText(depositData.depositAddress)
            setCopied(true)
            toast.success("Deposit address copied!")
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    }

    const item = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    }

    return (
        <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="space-y-6 text-white max-w-5xl mx-auto"
        >
            {/* Header */}
            <motion.div variants={item} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                        Bridge to Bardock
                    </h1>
                    <p className="text-gray-400 mt-1">
                        Deposit tokens to your unique address to traverse chains instantly.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${relayerOnline ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-gray-400">
                        Relayer {relayerOnline ? 'Online' : 'Offline'}
                    </span>
                </div>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Left Column: Deposit Card */}
                <motion.div variants={item} className="space-y-6">
                    <div className="relative overflow-hidden rounded-3xl bg-white/5 border border-white/10 p-8 backdrop-blur-md">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/20 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />

                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-3 bg-purple-500/20 rounded-xl">
                                    <ArrowLeftRight className="h-6 w-6 text-purple-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold">Deposit Address</h2>
                                    <p className="text-sm text-gray-400">BSC Testnet → Movement Bardock</p>
                                </div>
                            </div>

                            {!userAddress ? (
                                <div className="p-6 rounded-2xl bg-white/5 border border-dashed border-white/10 text-center">
                                    <Wallet className="h-8 w-8 text-gray-500 mx-auto mb-3" />
                                    <p className="text-gray-400 mb-4">Connect your Movement wallet to generate a deposit address.</p>
                                </div>
                            ) : !depositData ? (
                                <div className="p-6 rounded-2xl bg-white/5 border border-dashed border-white/10 text-center">
                                    {loading ? (
                                        <div className="flex flex-col items-center">
                                            <RefreshCw className="h-8 w-8 text-purple-400 animate-spin mb-3" />
                                            <p className="text-gray-400">Generating secure address...</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center">
                                            <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
                                            <p className="text-gray-400 mb-4">Could not connect to Bridge Relayer.</p>
                                            <Button onClick={fetchDepositAddress} size="sm" variant="outline" className="border-white/10">
                                                Retry
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="p-4 bg-black/40 rounded-2xl border border-white/5 mb-6">
                                        <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Send Mock Tokens to this address</p>
                                        <div className="flex items-center justify-between gap-2">
                                            <code className="text-sm md:text-base font-mono text-purple-200 break-all">
                                                {depositData.depositAddress}
                                            </code>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="hover:bg-white/10 text-gray-400 hover:text-white"
                                                onClick={copyToClipboard}
                                            >
                                                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex justify-center mb-6">
                                        <div className="p-4 bg-white rounded-2xl">
                                            <QRCodeSVG value={depositData.depositAddress} size={160} />
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <div className="flex-1 p-3 rounded-xl bg-white/5 border border-white/5 text-center">
                                            <p className="text-xs text-gray-500 mb-1">Network</p>
                                            <p className="font-semibold text-amber-400">BSC Testnet</p>
                                        </div>
                                        <div className="flex-1 p-3 rounded-xl bg-white/5 border border-white/5 text-center">
                                            <p className="text-xs text-gray-500 mb-1">Fee</p>
                                            <p className="font-semibold text-emerald-400">Sponsored</p>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* Right Column: Instructions & Status */}
                <motion.div variants={item} className="space-y-6">
                    <div className="rounded-3xl bg-white/5 border border-white/10 p-8">
                        <h3 className="text-lg font-bold mb-6">How it works</h3>

                        <div className="space-y-6">
                            {[
                                { step: "1", title: "Send Tokens", desc: "Send Mock USDC/MOVE from your BSC Testnet wallet to the Deposit Address." },
                                { step: "2", title: "Auto-Bridge", desc: "Our relayer detects the deposit and automatically fuels it with BNB for gas." },
                                { step: "3", title: "Receive", desc: "Assets arrive in your Movement Bardock wallet within ~60 seconds." }
                            ].map((s, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center font-bold text-purple-400 border border-purple-500/20">
                                        {s.step}
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-white">{s.title}</h4>
                                        <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-3xl bg-white/5 border border-white/10 p-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold">Supported Assets</h3>
                            <ExternalLink className="h-4 w-4 text-gray-500" />
                        </div>
                        <div className="flex gap-3">
                            {['Mock USDC', 'Mock MOVE'].map(token => (
                                <div key={token} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-sm font-medium">
                                    {token}
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-4">
                            Ensure you are only sending supported tokens on BSC Testnet. Unsupported tokens may be lost.
                        </p>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    )
}
