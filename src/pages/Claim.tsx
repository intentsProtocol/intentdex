import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Gift, ArrowRight, Search, Filter, Sparkles, Loader2 } from "lucide-react"
import { Link } from "react-router-dom"
import { getThemeById } from "@/lib/themeRegistry"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { aptos, CONTRACT_ADDRESS } from "@/lib/aptos"
import { TOKENS } from "@/lib/tokens"
import { formatDistanceToNow } from "date-fns"
import { useSignRawHash } from "@privy-io/react-auth/extended-chains"
import { AccountAuthenticatorEd25519, Ed25519PublicKey, Ed25519Signature, generateSigningMessageForTransaction } from "@aptos-labs/ts-sdk"
import { Buffer } from 'buffer';

interface GiftCardData {
    id: string
    sender: string
    from_name: string
    recipient_type: number
    recipient_identifier: string
    amount: string
    token_type: string
    fa_address: any
    message: string
    theme_id: string
    logo_url: string
    created_at: string
    expires_at: string
    claimed: boolean
    claimed_by: string
    claimed_at: string
}

export default function Claim() {
    useTranslation()
    const { user } = usePrivy()
    const { signRawHash } = useSignRawHash()
    const [claiming, setClaiming] = useState<string | null>(null)
    const [filter, setFilter] = useState("all")
    const [search, setSearch] = useState("")
    const [giftCards, setGiftCards] = useState<GiftCardData[]>([])
    const [loading, setLoading] = useState(true)

    // Find Movement wallet for signing claims
    const movementWallet = user?.linkedAccounts.find(
        (account) => account.type === 'wallet' && account.chainType === 'aptos'
    ) as WalletWithMetadata | undefined;

    useEffect(() => {
        if (!user) return
        fetchClaimableGifts()
    }, [user])

    const fetchClaimableGifts = async () => {
        try {
            setLoading(true)
            const allGifts: GiftCardData[] = []

            // Iterate identifiers
            const identifiers = []
            if (user?.email?.address) identifiers.push(user.email.address)
            if (user?.twitter?.username) identifiers.push(user.twitter.username)
            if (user?.discord?.username) identifiers.push(user.discord.username)

            for (const identifier of identifiers) {
                try {
                    const receivedIdsResponse = await aptos.view({
                        payload: {
                            function: `${CONTRACT_ADDRESS}::move_giftcards::get_recipient_giftcards`,
                            functionArguments: [identifier],
                        },
                    })
                    const receivedIds = receivedIdsResponse[0] as string[]

                    // Fetch details
                    const detailsPromises = receivedIds.map(async (id) => {
                        const details = await aptos.view({
                            payload: {
                                function: `${CONTRACT_ADDRESS}::move_giftcards::get_giftcard`,
                                functionArguments: [id],
                            },
                        })
                        return {
                            id,
                            sender: details[0],
                            from_name: details[1],
                            recipient_type: Number(details[2]),
                            recipient_identifier: details[3],
                            amount: details[4],
                            token_type: details[5],
                            fa_address: details[6],
                            message: details[7],
                            theme_id: details[8],
                            logo_url: details[9],
                            created_at: details[10],
                            expires_at: details[11],
                            claimed: details[12] as boolean,
                            claimed_by: details[13],
                            claimed_at: details[14],
                        } as GiftCardData
                    })

                    const fetched = await Promise.all(detailsPromises)

                    // Filter for UNCLAIMED and VALID
                    const now = Date.now() / 1000
                    const claimable = fetched.filter(g => !g.claimed && parseInt(g.expires_at) > now)

                    claimable.forEach(g => {
                        if (!allGifts.find(x => x.id === g.id)) allGifts.push(g)
                    })

                } catch (e) {
                    console.warn(`Failed to fetch for ${identifier}`, e)
                }
            }

            setGiftCards(allGifts)
        } catch (error) {
            console.error("Error fetching gifts:", error)
        } finally {
            setLoading(false)
        }
    }

    const filteredCards = giftCards.filter(card => {
        // filter logic options
        // if (filter !== "all" && card.recipient_type !== filter) return false // mapping needed
        if (search && !card.from_name.toLowerCase().includes(search.toLowerCase()) && !card.sender.toLowerCase().includes(search.toLowerCase())) return false
        return true
    })

    const handleClaim = async (giftCard: GiftCardData) => {
        if (!movementWallet) {
            toast.error("No connected Movement wallet found. Please create one on the Dashboard.")
            return
        }

        setClaiming(giftCard.id)
        try {
            toast.loading("Initiating claim...")

            // 1. Build Transaction
            const transaction = await aptos.transaction.build.simple({
                sender: movementWallet.address,
                data: {
                    function: `${CONTRACT_ADDRESS}::move_giftcards::claim_giftcard`,
                    functionArguments: [giftCard.id, giftCard.recipient_identifier],
                },
            });

            // 2. Sign
            const messageBytes = await generateSigningMessageForTransaction(transaction);

            // Fix: properly convert Uint8Array message to 0x-prefixed hex string
            const messageHexStr = Array.from(messageBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
            const messageHex = `0x${messageHexStr}` as `0x${string}`;

            const signatureHex = await signRawHash({
                address: movementWallet.address,
                chainType: 'aptos',
                hash: messageHex,
            });

            // 3. Submit
            const signatureBytes = Buffer.from(signatureHex.signature.replace('0x', ''), 'hex');

            // Get Public Key from Privy object (cast to any as it might be missing in type)
            const walletObj = movementWallet as any;
            const publicKeyStr = walletObj.publicKey;
            if (!publicKeyStr) throw new Error("Public Key not found in wallet object");

            const cleanPublicKey = publicKeyStr.replace(/^0x/, '');
            let publicKeyBytes = Buffer.from(cleanPublicKey, 'hex');

            // Handle 33-byte key (strip leading 00 if present)
            if (publicKeyBytes.length === 33) {
                publicKeyBytes = publicKeyBytes.slice(1);
            }

            const authenticator = new AccountAuthenticatorEd25519(
                new Ed25519PublicKey(publicKeyBytes),
                new Ed25519Signature(signatureBytes)
            );

            const pendingTxn = await aptos.transaction.submit.simple({
                transaction,
                senderAuthenticator: authenticator,
            });

            toast.dismiss()
            toast.loading("Transaction submitted! Waiting for confirmation...")

            await aptos.waitForTransaction({ transactionHash: pendingTxn.hash });

            toast.dismiss()
            toast.success("Gift claimed successfully! Funds added to your wallet. 🎉")

            // Refresh list
            fetchClaimableGifts()

        } catch (error: any) {
            console.error(error)
            toast.dismiss()
            toast.error("Failed to claim: " + (error.message || "Unknown error"))
        } finally {
            setClaiming(null)
        }
    }

    const formatAmount = (amount: string, symbol: string) => {
        const token = TOKENS.find(t => t.symbol === symbol)
        const decimals = token ? token.decimals : 8
        const val = parseInt(amount) / Math.pow(10, decimals)
        return val.toLocaleString(undefined, { maximumFractionDigits: 4 })
    }

    return (
        <div className="space-y-6 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Claim Your Gifts 🎁</h1>
                    <p className="text-gray-400">You have {giftCards.length} pending gift cards waiting!</p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Search by sender..."
                        className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-white/10 text-white">
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="twitter">Twitter</SelectItem>
                        <SelectItem value="discord">Discord</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-4">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="h-12 w-12 animate-spin text-purple-400" />
                    </div>
                ) : filteredCards.length === 0 ? (
                    <Card className="text-center py-12 bg-white/5 border-white/10">
                        <CardContent>
                            <Gift className="h-12 w-12 mx-auto text-gray-500 mb-4" />
                            <h3 className="text-lg font-medium mb-2 text-white">No gifts found</h3>
                            <p className="text-gray-500">{search || filter !== "all" ? "Try adjusting your filters" : "You don't have any pending gifts"}</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredCards.map((card) => {
                            const theme = getThemeById(card.theme_id || 'modern');
                            return (
                                <div key={card.id} className="group relative aspect-square">
                                    <div className={`absolute inset-0 rounded-3xl ${theme.styles.background} opacity-90 transition-all duration-300 group-hover:scale-[1.02] shadow-xl`} />

                                    {/* Card Content */}
                                    <div className="relative h-full flex flex-col justify-between p-6 text-white">

                                        {/* Header */}
                                        <div className="flex justify-between items-start">
                                            <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                                                <Gift className="h-6 w-6 text-white" />
                                            </div>
                                            {/* Expiring Badge Logic could go here */}
                                        </div>

                                        {/* Main Info */}
                                        <div className="space-y-2 text-center">
                                            <div className="text-sm font-medium text-white/80 uppercase tracking-wider">You received</div>
                                            <div className="text-4xl font-bold font-mono tracking-tight drop-shadow-sm">
                                                {formatAmount(card.amount, card.token_type)} <span className="text-sm">{card.token_type}</span>
                                            </div>
                                            <div className="text-sm font-medium text-white/90">from {card.from_name || `${card.sender.slice(0, 6)}...`}</div>
                                        </div>

                                        {/* Message Preview */}
                                        {card.message && (
                                            <div className="text-center px-4">
                                                <p className="text-sm text-white/80 line-clamp-2 italic">"{card.message}"</p>
                                            </div>
                                        )}

                                        {/* Footer / Action */}
                                        <div className="mt-auto pt-4">
                                            <Button
                                                className="w-full bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-md transition-all h-12 rounded-xl font-semibold shadow-lg"
                                                onClick={() => handleClaim(card)}
                                                disabled={claiming === card.id}
                                            >
                                                {claiming === card.id ? (
                                                    <span className="flex items-center gap-2">Claiming... <Sparkles className="h-4 w-4 animate-spin" /></span>
                                                ) : (
                                                    <span className="flex items-center gap-2">Tap to Unwrap <ArrowRight className="h-4 w-4" /></span>
                                                )}
                                            </Button>
                                            <div className="text-xs text-center mt-3 text-white/60">
                                                Sent {formatDistanceToNow(parseInt(card.created_at) * 1000, { addSuffix: true })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <Card className="bg-white/5 border-white/10">
                <CardHeader>
                    <CardTitle className="text-white">Have a Gift ID?</CardTitle>
                    <CardDescription className="text-gray-400">Enter the ID from your email or message to claim</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-3">
                        <Input placeholder="Enter Gift ID (e.g. 12345)" className="flex-1 bg-black/20 border-white/10 text-white" />
                        <Button asChild className="bg-purple-600 hover:bg-purple-700">
                            <Link to="/claim/redeem">
                                Lookup <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
