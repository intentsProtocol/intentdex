import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Gift, Download, Activity, Clock, TrendingUp, Plus,
    ArrowUpRight, ArrowDownLeft, Wallet, Sparkles, Users,
    ChevronRight, ExternalLink, Copy
} from "lucide-react"
import { Link } from "react-router-dom"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { useCreateWallet } from "@privy-io/react-auth/extended-chains"
import { toast } from "sonner"
import { motion } from "framer-motion"
import { getThemeById } from "@/lib/themeRegistry"
import { TOKENS, type TokenInfo } from "@/lib/tokens"
import { aptos, CONTRACT_ADDRESS } from "@/lib/aptos"
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"

interface GiftCardDetails {
    id: string
    sender: string
    from_name: string
    recipient_type: number
    recipient_identifier: string
    amount: string
    token_type: string
    created_at: string
    expires_at: string
    claimed: boolean
    claimed_by: string
    claimed_at: string
    message: string
    theme_id: string
}

interface DashboardActivity {
    id: string
    action: "sent" | "received" | "claimed"
    amount: string
    token: string
    counterparty: string
    time: string
    txHash: string
    rawDate: number
}

export default function Dashboard() {
    const { user, linkTwitter, linkDiscord } = usePrivy()

    const { createWallet } = useCreateWallet()

    // Find the Movement address from linked accounts
    // We look for a wallet with chainType 'aptos' (since Movement is Aptos-compatible)
    const movementWallet = user?.linkedAccounts.find(
        (account) => account.type === 'wallet' && account.chainType === 'aptos'
    ) as WalletWithMetadata | undefined;

    // We strictly want the Aptos/Movement address.
    // If not found, we don't fallback to EVM address to avoid confusion.
    const displayAddress = movementWallet?.address || "Movement Wallet Not Found";

    const handleCreateWallet = async () => {
        try {
            // @ts-ignore - 'aptos' should be valid for extended chains
            await createWallet({ chainType: 'aptos' });
            toast.success("Movement wallet created!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to create wallet: " + (error as Error).message);
        }
    }

    // Debug logging
    // console.log("Full Privy User Object:", user);
    // console.log("Linked Accounts:", user?.linkedAccounts);
    // console.log("Derived Movement Wallet:", movementWallet);
    // console.log("Display Address:", displayAddress);



    // ... inside component ...
    const [balances, setBalances] = useState<(TokenInfo & { amount: string, usdValue: string })[]>([])
    // @ts-ignore
    const [isLoadingBalances, setIsLoadingBalances] = useState(false)

    useEffect(() => {
        const fetchBalances = async () => {
            console.log("[Dashboard] fetchBalances called");
            console.log("[Dashboard] displayAddress:", displayAddress);

            if (!displayAddress || displayAddress.includes("Not Found")) {
                console.log("[Dashboard] Skipping - no valid address");
                return;
            }
            setIsLoadingBalances(true);

            const newBalances = await Promise.all(TOKENS.map(async (t) => {
                let amountStr = "0";
                console.log(`[Dashboard] Fetching balance for ${t.symbol}...`);
                try {
                    // 1. If it has a coinType (standard Coin), use SDK helper
                    if (t.coinType) {
                        console.log(`[Dashboard] ${t.symbol}: Using coinType ${t.coinType}`);
                        const amount = await aptos.getAccountCoinAmount({
                            accountAddress: displayAddress,
                            coinType: t.coinType as any,
                        });
                        amountStr = amount.toString();
                        console.log(`[Dashboard] ${t.symbol}: Raw amount = ${amountStr}`);
                    }
                    // 2. If it has no coinType but has faAddress, use PrimaryFungibleStore view
                    else if (t.faAddress) {
                        console.log(`[Dashboard] ${t.symbol}: Using faAddress ${t.faAddress}`);
                        const result = await aptos.view({
                            payload: {
                                function: "0x1::primary_fungible_store::balance",
                                typeArguments: ["0x1::fungible_asset::Metadata"],
                                functionArguments: [displayAddress, t.faAddress],
                            }
                        });
                        // View returns an array, first element is balance
                        amountStr = result[0]?.toString() || "0";
                        console.log(`[Dashboard] ${t.symbol}: Raw amount = ${amountStr}`);
                    }
                } catch (e) {
                    console.warn(`[Dashboard] Failed to fetch balance for ${t.symbol}:`, e);
                }

                // Format decimals
                const val = Number(amountStr) / Math.pow(10, t.decimals);
                console.log(`[Dashboard] ${t.symbol}: Formatted = ${val}`);
                const formatter = new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                });

                return {
                    ...t,
                    amount: formatter.format(val),
                    usdValue: "-" // Placeholder as we don't have price feed yet
                };
            }));

            console.log("[Dashboard] Final balances:", newBalances);
            setBalances(newBalances);
            setIsLoadingBalances(false);
        };

        fetchBalances();
        // Refresh every 30s
        const interval = setInterval(fetchBalances, 30000);
        return () => clearInterval(interval);
    }, [displayAddress]);

    const walletData = {
        address: displayAddress,
        balances: balances.length > 0 ? balances : [],
        totalUsd: "-"
    }

    const copyAddress = () => {
        navigator.clipboard.writeText(displayAddress)
        toast.success("Address copied!")
    }

    // --- Dashboard Data State ---
    const [sentCards, setSentCards] = useState<any[]>([]) // Using any for UI mapping simplicity or define interface
    const [recentActivity, setRecentActivity] = useState<DashboardActivity[]>([])
    const [stats, setStats] = useState({
        totalSent: 0,
        totalSentValue: "$0",
        totalReceived: 0,
        totalReceivedValue: "$0",
        pending: 0,
        claimed: 0,
        successRate: 0
    })
    const [claimableCards, setClaimableCards] = useState<any[]>([])

    useEffect(() => {
        if (!user) return
        fetchDashboardData()
        const interval = setInterval(fetchDashboardData, 30000)
        return () => clearInterval(interval)
    }, [user, displayAddress])

    const fetchDashboardData = async () => {
        try {
            const allTxs: any[] = []
            let totalSent = 0
            let totalReceived = 0
            let pendingCount = 0
            let claimedCount = 0
            let rawSent: any[] = []

            // 1. Fetch SENT gifts
            if (displayAddress && !displayAddress.includes("Not Found")) {
                try {
                    const sentIdsResponse = await aptos.view({
                        payload: {
                            function: `${CONTRACT_ADDRESS}::move_giftcards::get_sender_giftcards`,
                            functionArguments: [displayAddress],
                        },
                    })
                    const sentIds = sentIdsResponse[0] as string[]
                    const sentDetails = await fetchGiftCardDetails(sentIds)

                    rawSent = sentDetails.map(d => ({ ...d, type: 'sent' }))
                    totalSent = sentDetails.length

                    sentDetails.forEach(d => {
                        if (d.claimed) claimedCount++
                        else pendingCount++ // Simple logic, ignores expired for success rate calc
                    })

                    rawSent.forEach(d => {
                        allTxs.push(mapToActivity(d, 'sent', true))
                        if (d.claimed) allTxs.push(mapToActivity(d, 'claimed', true))
                    })
                } catch (e) {
                    console.warn("Failed to fetch sent gifts", e)
                }
            }

            // 2. Fetch RECEIVED gifts
            const identifiers = []
            if (user?.email?.address) identifiers.push(user.email.address)
            if (user?.twitter?.username) identifiers.push(user.twitter.username)
            if (user?.discord?.username) identifiers.push(user.discord.username)

            const receivedDetailsList: any[] = []
            for (const identifier of identifiers) {
                try {
                    const receivedIdsResponse = await aptos.view({
                        payload: {
                            function: `${CONTRACT_ADDRESS}::move_giftcards::get_recipient_giftcards`,
                            functionArguments: [identifier],
                        },
                    })
                    const receivedIds = receivedIdsResponse[0] as string[]
                    const details = await fetchGiftCardDetails(receivedIds)
                    details.forEach(d => {
                        if (!receivedDetailsList.find(x => x.id === d.id)) {
                            receivedDetailsList.push(d)
                            totalReceived++
                            allTxs.push(mapToActivity(d, 'received', false))
                            if (d.claimed) allTxs.push(mapToActivity(d, 'claimed', false))
                        }
                    })
                } catch (e) { console.warn("Failed fetch received", e) }
            }

            // Sort Activity by Date Desc
            allTxs.sort((a, b) => b.rawDate - a.rawDate)

            // Update State
            setRecentActivity(allTxs.slice(0, 5))
            setSentCards(rawSent.sort((a, b) => parseInt(b.created_at) - parseInt(a.created_at)).slice(0, 3).map(mapToSentCard))
            setStats({
                totalSent,
                totalSentValue: `${totalSent > 0 ? totalSent * 1.5 : 0} MOVE`, // Placeholder val
                totalReceived,
                totalReceivedValue: "-",
                pending: pendingCount,
                claimed: claimedCount,
                successRate: totalSent > 0 ? Math.round((claimedCount / totalSent) * 100) : 0
            })

            // Set alerts for unclaimed received gifts
            const pendingReceived = receivedDetailsList.filter(d => !d.claimed && parseInt(d.expires_at) > Date.now() / 1000)
            setClaimableCards(pendingReceived.map(mapToAlertCard))

        } catch (error) {
            console.error("Dashboard fetch error:", error)
        }
    }

    const fetchGiftCardDetails = async (ids: string[]) => {
        if (ids.length === 0) return []
        const promises = ids.map(async (id) => {
            const details = await aptos.view({
                payload: {
                    function: `${CONTRACT_ADDRESS}::move_giftcards::get_giftcard`,
                    functionArguments: [id],
                },
            })
            // Extract message and theme_id specifically
            return {
                id,
                sender: details[0],
                recipient_identifier: details[3],
                amount: details[4],
                token_type: details[5],
                message: details[7],
                theme_id: details[8],
                created_at: details[10],
                expires_at: details[11],
                claimed: details[12],
                claimed_by: details[13],
                claimed_at: details[14],
            } as GiftCardDetails
        })
        return Promise.all(promises)
    }

    const formatAmount = (amount: string, symbol: string) => {
        const token = TOKENS.find(t => t.symbol === symbol)
        const decimals = token ? token.decimals : 8
        return (parseInt(amount) / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    const mapToActivity = (d: GiftCardDetails, type: 'sent' | 'received' | 'claimed', isSender: boolean): DashboardActivity => {
        const timestamp = type === 'claimed' ? parseInt(d.claimed_at) : parseInt(d.created_at)
        return {
            id: `${d.id}-${type}`, // Unique ID for event
            action: type,
            amount: `${formatAmount(d.amount, d.token_type)} ${d.token_type}`,
            token: d.token_type,
            counterparty: isSender ? d.recipient_identifier : `${d.sender.slice(0, 4)}...${d.sender.slice(-4)}`,
            time: formatDistanceToNow(timestamp * 1000, { addSuffix: true }),
            txHash: `#${d.id}`,
            rawDate: timestamp
        }
    }

    const mapToSentCard = (d: GiftCardDetails) => {
        let status = "pending"
        if (d.claimed) status = "claimed"
        else if (parseInt(d.expires_at) < Date.now() / 1000) status = "expired"

        return {
            id: d.id,
            amount: formatAmount(d.amount, d.token_type),
            token: d.token_type,
            recipient: d.recipient_identifier,
            status,
            date: formatDistanceToNow(parseInt(d.created_at) * 1000, { addSuffix: true }),
            message: d.message,
            theme: d.theme_id || 'modern'
        }
    }

    const mapToAlertCard = (d: GiftCardDetails) => ({
        id: d.id,
        amount: formatAmount(d.amount, d.token_type),
        token: d.token_type,
        from: `${d.sender.slice(0, 6)}...`,
        message: d.message,
        expiresIn: formatDistanceToNow(parseInt(d.expires_at) * 1000)
    })

    const getStatusColor = (status: string) => {
        switch (status) {
            case "claimed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/20"
            case "pending": return "bg-amber-500/20 text-amber-400 border-amber-500/20"
            case "expired": return "bg-red-500/20 text-red-400 border-red-500/20"
            default: return "bg-gray-500/20 text-gray-400"
        }
    }

    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
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
            className="space-y-6 text-white"
        >
            {/* Welcome Header */}
            <motion.div variants={item} className="relative overflow-hidden rounded-3xl bg-white/5 border border-white/10 p-8 backdrop-blur-md">
                <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="h-5 w-5 text-purple-400" />
                            <span className="text-sm font-medium text-purple-200/80">Dashboard Overview</span>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold mb-2 tracking-tight">
                            Welcome back
                        </h1>
                        <div className="flex flex-col md:flex-row md:items-center gap-3">
                            {/* Identity Badge */}
                            {(user?.email?.address || user?.twitter?.username) && (
                                <div className="px-3 py-1 rounded-full bg-white/10 border border-white/5 text-sm font-medium text-gray-300">
                                    {user?.email?.address || user?.twitter?.username}
                                </div>
                            )}

                            {/* Wallet Address Badge */}
                            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-sm font-mono text-purple-200">
                                <Wallet className="h-3 w-3 mr-1" />
                                {movementWallet ? (
                                    <>
                                        {displayAddress.slice(0, 6)}...{displayAddress.slice(-4)}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-4 w-4 ml-1 text-purple-400 hover:text-white hover:bg-purple-500/20 rounded-full"
                                            onClick={copyAddress}
                                        >
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </>
                                ) : (
                                    <span className="text-gray-400">No Wallet</span>
                                )}
                            </div>

                            {!movementWallet && (
                                <Button
                                    size="sm"
                                    onClick={handleCreateWallet}
                                    className="h-8 bg-purple-600 hover:bg-purple-700 text-white border-0"
                                >
                                    Create Movement Wallet
                                </Button>
                            )}

                            {/* Social Links */}
                            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-white/10">
                                {user?.twitter?.username ? (
                                    <a
                                        href={`https://x.com/${user.twitter.username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 rounded-full bg-black/40 text-gray-400 hover:text-white hover:bg-black/60 transition-colors"
                                        title={`Connected: @${user.twitter.username}`}
                                    >
                                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                    </a>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => linkTwitter()}
                                        className="h-8 px-2 text-xs bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5"
                                    >
                                        <svg className="h-3 w-3 mr-1.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                        Link X
                                    </Button>
                                )}

                                {user?.discord?.username ? (
                                    <div className="p-1.5 rounded-full bg-[#5865F2]/20 text-[#5865F2] hover:bg-[#5865F2]/30 transition-colors cursor-default" title={`Connected: ${user.discord.username}`}>
                                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037.189.189 0 0 1-.189.189 2.004 2.004 0 0 1-.954-.363c-.45-.45-1.127-1.127-2.3-2.3a18.35 18.35 0 0 0-8.132 3.126.077.077 0 0 0-.004.127l.128.176a16.86 16.86 0 0 0 4.305 15.65.074.074 0 0 0 .092-.008L9.2 18.23a.072.072 0 0 0-.077-.107 10.603 10.603 0 0 1-2.91-1.428.077.077 0 0 1 .09-.133c.189.108.388.223.585.312a.08.08 0 0 0 .091-.013c.279-.276.551-.57.817-.878a.077.077 0 0 0-.03-.122 17.768 17.768 0 0 1-5.323-2.738.078.078 0 0 0-.115.029c-1.353 2.115-1.745 4.187-1.493 6.096a.079.079 0 0 0 .034.059 19.895 19.895 0 0 0 6.002 3.03.077.077 0 0 0 .084-.029l.716-1.921a.077.077 0 0 1 .081-.05c2.378.11 4.757.11 7.135 0a.078.078 0 0 1 .082.049l.716 1.922a.077.077 0 0 0 .084.028 19.892 19.892 0 0 0 6.002-3.03.076.076 0 0 0 .034-.058c.28-2.227-.333-4.321-1.776-6.155a.079.079 0 0 0 -.115-.029 17.432 17.432 0 0 1-5.323 2.736.077.077 0 0 0-.029.123 11.237 11.237 0 0 1 .818.878.078.078 0 0 0 .092.012c.196-.09.395-.205.584-.313a.077.077 0 0 1 .091.134 10.62 10.62 0 0 1-2.911 1.428.073.073 0 0 0-.077.106l.891 1.258a.074.074 0 0 0 .092.008 16.892 16.892 0 0 0 4.305-15.65.077.077 0 0 0 .128-.176 18.28 18.28 0 0 0-8.134-3.125.077.077 0 0 0-.079.037z" />
                                        </svg>
                                    </div>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => linkDiscord()}
                                        className="h-8 px-2 text-xs bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5"
                                    >
                                        <svg className="h-3 w-3 mr-1.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037.189.189 0 0 1-.189.189 2.004 2.004 0 0 1-.954-.363c-.45-.45-1.127-1.127-2.3-2.3a18.35 18.35 0 0 0-8.132 3.126.077.077 0 0 0-.004.127l.128.176a16.86 16.86 0 0 0 4.305 15.65.074.074 0 0 0 .092-.008L9.2 18.23a.072.072 0 0 0-.077-.107 10.603 10.603 0 0 1-2.91-1.428.077.077 0 0 1 .09-.133c.189.108.388.223.585.312a.08.08 0 0 0 .091-.013c.279-.276.551-.57.817-.878a.077.077 0 0 0-.03-.122 17.768 17.768 0 0 1-5.323-2.738.078.078 0 0 0-.115.029c-1.353 2.115-1.745 4.187-1.493 6.096a.079.079 0 0 0 .034.059 19.895 19.895 0 0 0 6.002 3.03.077.077 0 0 0 .084-.029l.716-1.921a.077.077 0 0 1 .081-.05c2.378.11 4.757.11 7.135 0a.078.078 0 0 1 .082.049l.716 1.922a.077.077 0 0 0 .084.028 19.892 19.892 0 0 0 6.002-3.03.076.076 0 0 0 .034-.058c.28-2.227-.333-4.321-1.776-6.155a.079.079 0 0 0 -.115-.029 17.432 17.432 0 0 1-5.323 2.736.077.077 0 0 0-.029.123 11.237 11.237 0 0 1 .818.878.078.078 0 0 0 .092.012c.196-.09.395-.205.584-.313a.077.077 0 0 1 .091.134 10.62 10.62 0 0 1-2.911 1.428.073.073 0 0 0-.077.106l.891 1.258a.074.074 0 0 0 .092.008 16.892 16.892 0 0 0 4.305-15.65.077.077 0 0 0 .128-.176 18.28 18.28 0 0 0-8.134-3.125.077.077 0 0 0-.079.037z" />
                                        </svg>
                                        Link Discord
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <Button asChild size="lg" className="bg-white text-black hover:bg-gray-200 font-semibold shadow-lg shadow-white/10">
                            <Link to="/send">
                                <Plus className="mr-2 h-5 w-5" />
                                Send Gift
                            </Link>
                        </Button>
                        <Button asChild variant="outline" size="lg" className="bg-transparent border-white/20 text-white hover:bg-white/10">
                            <Link to="/claim">
                                <Download className="mr-2 h-5 w-5" />
                                Claim
                            </Link>
                        </Button>
                    </div>
                </div>
            </motion.div>

            {/* Stats Grid */}
            <motion.div variants={container} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Balance Card */}
                <motion.div variants={item} className="md:col-span-2 group relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/50 to-indigo-900/50 border border-white/10 p-6">
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-sm font-medium text-gray-400">Total Balance</h3>
                        <Wallet className="h-5 w-5 text-purple-400" />
                    </div>
                    <div className="text-4xl font-bold mb-6">{walletData.totalUsd}</div>
                    <div className="space-y-3">
                        {walletData.balances.map((bal: any) => (
                            <div key={bal.symbol} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                                        {bal.logoUrl ? (
                                            <img src={bal.logoUrl} alt={bal.symbol} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-xs font-bold">{bal.symbol[0]}</span>
                                        )}
                                    </div>
                                    <span className="font-medium">{bal.amount} {bal.symbol}</span>
                                </div>
                                {/* Value display commented out or simplified as we don't fetch prices yet */}
                                {/* 
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-400">{bal.usdValue}</span>
                                </div> 
                                */}
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Pending */}
                <motion.div variants={item} className="rounded-2xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">Pending Gifts</h3>
                        <Clock className="h-4 w-4 text-amber-400" />
                    </div>
                    <div className="text-3xl font-bold mb-1">{stats.pending}</div>
                    <p className="text-xs text-gray-500 mb-4">Waiting to be claimed</p>
                    <Link to="/history" className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                        View details <ChevronRight className="h-3 w-3" />
                    </Link>
                </motion.div>

                {/* Success Rate */}
                <motion.div variants={item} className="rounded-2xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">Success Rate</h3>
                        <Activity className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="text-3xl font-bold mb-2">{stats.successRate}%</div>
                    <Progress value={stats.successRate} className="h-1.5 bg-white/10 [&>div]:bg-emerald-500" />
                    <p className="text-xs text-gray-500 mt-3">{stats.claimed} of {stats.totalSent} claimed</p>
                </motion.div>
            </motion.div>

            {/* Claim Alert */}
            {claimableCards.length > 0 && (
                <motion.div variants={item} className="rounded-2xl bg-gradient-to-r from-emerald-900/40 to-teal-900/40 border border-emerald-500/20 p-1 relative overflow-hidden">
                    <div className="absolute inset-0 bg-emerald-500/5 backdrop-blur-[2px]" />
                    <div className="relative p-4 flex items-center gap-4">
                        <div className="p-3 bg-emerald-500/20 rounded-full">
                            <Gift className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-white">You have a gift to claim! 🎁</h3>
                            <p className="text-sm text-emerald-200/70">
                                {claimableCards[0].amount} {claimableCards[0].token} from {claimableCards[0].from}
                            </p>
                        </div>
                        <Button asChild className="bg-emerald-500 hover:bg-emerald-600 text-white border-0">
                            <Link to="/claim">
                                Claim <ArrowUpRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </motion.div>
            )}

            {/* Main Grid */}
            <motion.div variants={container} className="grid gap-6 lg:grid-cols-3">
                {/* Sent Gifts */}
                <motion.div variants={item} className="lg:col-span-2 rounded-2xl bg-white/5 border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-lg font-bold">Recent Sent Gifts</h2>
                            <p className="text-sm text-gray-500">Track status of your gifts</p>
                        </div>
                        <Link to="/history" className="text-sm text-purple-400 hover:text-purple-300">View All</Link>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                        {sentCards.map((card) => {
                            const theme = getThemeById(card.theme || 'modern');
                            return (
                                <div key={card.id} className={`group relative rounded-xl border border-white/5 p-4 hover:border-purple-500/30 transition-all hover:-translate-y-1 overflow-hidden`}>
                                    {/* Theme Background */}
                                    <div className={`absolute inset-0 ${theme.styles.background} opacity-20 group-hover:opacity-30 transition-opacity`} />

                                    <div className="relative z-10">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                                                <Gift className="h-4 w-4 text-white" />
                                            </div>
                                            <Badge variant="outline" className={`${getStatusColor(card.status)} border-0 backdrop-blur-md`}>
                                                {card.status}
                                            </Badge>
                                        </div>
                                        <div className="text-xl font-bold mb-1 text-white shadow-sm">{card.amount} {card.token}</div>
                                        <div className="text-sm text-gray-200 truncate mb-3 font-medium">{card.recipient}</div>
                                        <div className="flex items-center justify-between pt-3 border-t border-white/10">
                                            <span className="text-xs text-gray-300">{card.date}</span>
                                            <ExternalLink className="h-3 w-3 text-gray-300 group-hover:text-white transition-colors" />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}

                        {/* Create New Card */}
                        <Link to="/send" className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/5 hover:bg-white/10 hover:border-purple-500/50 transition-all p-4 min-h-[160px] group">
                            <div className="p-3 bg-white/5 rounded-full mb-3 group-hover:scale-110 group-hover:bg-purple-500/20 transition-all">
                                <Plus className="h-6 w-6 text-gray-400 group-hover:text-purple-400" />
                            </div>
                            <span className="text-sm font-medium text-gray-300 group-hover:text-white">Send New Gift</span>
                        </Link>
                    </div>
                </motion.div>

                {/* Activity Feed */}
                <motion.div variants={item} className="rounded-2xl bg-white/5 border border-white/10 p-6">
                    <h2 className="text-lg font-bold mb-6">Activity Feed</h2>
                    <div className="space-y-4">
                        {recentActivity.map((item) => (
                            <div key={item.id} className="flex gap-4 items-start group">
                                <div className={`mt-1 p-2 rounded-full flex-shrink-0 ${item.action === "sent" ? "bg-purple-500/10 text-purple-400" :
                                    item.action === "claimed" ? "bg-emerald-500/10 text-emerald-400" :
                                        "bg-blue-500/10 text-blue-400"
                                    }`}>
                                    {item.action === "sent" && <ArrowUpRight className="h-4 w-4" />}
                                    {item.action === "claimed" && <Download className="h-4 w-4" />}
                                    {item.action === "received" && <ArrowDownLeft className="h-4 w-4" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-300">
                                        <span className="capitalize text-white font-medium">{item.action}</span>{' '}
                                        <span className={
                                            item.action === "sent" ? "text-purple-400" :
                                                item.action === "claimed" ? "text-emerald-400" : "text-blue-400"
                                        }>{item.amount}</span>
                                        {' '}{item.action === "received" ? "from" : "to"}{' '}
                                        <span className="text-gray-400">{item.counterparty}</span>
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-gray-600">{item.time}</span>
                                        <span className="text-xs text-gray-700">•</span>
                                        <Link to="#" className="text-xs text-gray-600 hover:text-purple-400 transition-colors truncate max-w-[80px]">
                                            {item.txHash}
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </motion.div>

            {/* Quick Stats */}
            <motion.div variants={container} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: "Total Sent", value: stats.totalSent, icon: ArrowUpRight, color: "text-purple-400", bg: "bg-purple-500/10" },
                    { label: "Total Received", value: stats.totalReceived, icon: ArrowDownLeft, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                    { label: "Unique People", value: "23", icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
                    { label: "Volume", value: stats.totalSentValue, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10" }
                ].map((stat, i) => (
                    <motion.div variants={item} key={i} className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center gap-4 hover:bg-white/10 transition-colors">
                        <div className={`p-3 rounded-xl ${stat.bg}`}>
                            <stat.icon className={`h-5 w-5 ${stat.color}`} />
                        </div>
                        <div>
                            <div className="text-xl font-bold">{stat.value}</div>
                            <div className="text-xs text-gray-500">{stat.label}</div>
                        </div>
                    </motion.div>
                ))}
            </motion.div>
        </motion.div>
    )
}

