import { useEffect, useState } from "react"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { useSignRawHash } from "@privy-io/react-auth/extended-chains"
import { AccountAuthenticatorEd25519, Ed25519PublicKey, Ed25519Signature, generateSigningMessageForTransaction } from "@aptos-labs/ts-sdk"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from "sonner"
import { Gift, Plus, Loader2, Sparkles } from "lucide-react"
import { aptos, CONTRACT_ADDRESS } from "@/lib/aptos"
import { GiftCardPreview } from "@/components/GiftCardPreview"
import { CreateExploreGift } from "@/components/CreateExploreGift"
import { formatDistanceToNow } from "date-fns"
import { Buffer } from 'buffer'

interface ExploreGiftData {
    id: string
    sender: string
    fromName: string
    amount: string
    tokenType: string
    message: string
    themeId: string
    logoUrl: string
    createdAt: number
    expiresAt: number
    claimed: boolean
    claimedBy: string
    requiredSocials: number[]
    matchLogic: number
}

export default function Explore() {
    const { user, getAccessToken } = usePrivy()
    const { signRawHash } = useSignRawHash()
    const [gifts, setGifts] = useState<ExploreGiftData[]>([])
    const [loading, setLoading] = useState(true)
    const [createOpen, setCreateOpen] = useState(false)
    const [claimingId, setClaimingId] = useState<string | null>(null)

    useEffect(() => {
        fetchPublicGifts()
    }, [])

    const fetchPublicGifts = async () => {
        try {
            setLoading(true)

            // Get list of public gift IDs
            const result = await aptos.view({
                payload: {
                    function: `${CONTRACT_ADDRESS}::explore_gifts::get_public_gifts`,
                    typeArguments: [],
                    functionArguments: []
                }
            })

            const ids = result[0] as string[]

            if (!ids || ids.length === 0) {
                setGifts([])
                return
            }

            // Fetch details for each (newest first, limit 20)
            const recentIds = ids.slice(-20).reverse()
            const fetchedGifts: ExploreGiftData[] = []

            for (const id of recentIds) {
                try {
                    const details = await aptos.view({
                        payload: {
                            function: `${CONTRACT_ADDRESS}::explore_gifts::get_explore_gift`,
                            typeArguments: [],
                            functionArguments: [id]
                        }
                    }) as any[]

                    // Parse: sender, from_name, amount, token_type, message, theme_id, logo_url
                    // created_at, expires_at, claimed, claimed_by, claimed_at, required_socials, match_logic
                    const formattedAmount = (parseInt(details[2]) / 1e8).toFixed(4)


                    // Parse helper to handle SDK return types (hex string or array)
                    const parseSocials = (raw: any): number[] => {
                        if (!raw) return []
                        if (Array.isArray(raw)) return raw.map(Number)
                        if (raw instanceof Uint8Array) return Array.from(raw)
                        if (typeof raw === 'string') {
                            const hex = raw.startsWith('0x') ? raw.slice(2) : raw
                            const result = []
                            for (let i = 0; i < hex.length; i += 2) {
                                result.push(parseInt(hex.substring(i, i + 2), 16))
                            }
                            return result
                        }
                        return []
                    }

                    fetchedGifts.push({
                        id,
                        sender: details[0],
                        fromName: details[1],
                        amount: formattedAmount,
                        tokenType: details[3],
                        message: details[4],
                        themeId: details[5],
                        logoUrl: details[6],
                        createdAt: parseInt(details[7]),
                        expiresAt: parseInt(details[8]),
                        claimed: details[9],
                        claimedBy: details[10],
                        requiredSocials: parseSocials(details[12]),
                        matchLogic: details[13] || 0
                    })
                } catch (e) {
                    console.error(`Failed to fetch gift ${id}`, e)
                }
            }

            setGifts(fetchedGifts)
        } catch (e) {
            console.error("Failed to fetch public gifts", e)
            toast.error("Failed to load gifts")
        } finally {
            setLoading(false)
        }
    }

    const getSocialLabel = (socials: number[]) => {
        const labels = socials.map(s => {
            if (s === 1) return "Email"
            if (s === 2) return "Twitter"
            if (s === 3) return "Discord"
            return ""
        }).filter(Boolean)
        return labels.length > 0 ? labels.join(", ") : "None"
    }

    const handleClaim = async (gift: ExploreGiftData) => {
        if (!user) {
            toast.error("Please login to claim gifts")
            return
        }

        const movementWallet = user.linkedAccounts.find(
            (account) => account.type === 'wallet' && account.chainType === 'aptos'
        ) as WalletWithMetadata | undefined

        if (!movementWallet) {
            toast.error("No Aptos wallet connected")
            return
        }

        try {
            setClaimingId(gift.id)
            toast.loading("Verifying eligibility...")

            // 1. Get backend signature
            const authToken = await getAccessToken()
            const response = await fetch(`${import.meta.env.VITE_SIGNING_SERVER_URL || 'http://localhost:3000'}/api/verify-explore-eligibility`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    giftCardId: gift.id,
                    claimerAddress: movementWallet.address,
                    privyAuthToken: authToken
                })
            })

            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || "Verification failed")
            }

            const { signature } = await response.json() // Hex string

            // Convert signature hex to bytes
            const signatureBytes = new Uint8Array(
                signature.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
            )

            // 2. Submit Transaction
            toast.dismiss()
            toast.loading("Signing claim transaction...")

            const transaction = await aptos.transaction.build.simple({
                sender: movementWallet.address,
                data: {
                    function: `${CONTRACT_ADDRESS}::explore_gifts::claim_explore_gift`,
                    functionArguments: [gift.id, signatureBytes],
                },
            })

            // Sign with correct parameters
            const messageBytes = await generateSigningMessageForTransaction(transaction)
            const messageHex = `0x${Array.from(messageBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`

            const signatureHex = await signRawHash({
                address: movementWallet.address,
                chainType: 'aptos',
                hash: messageHex,
            })

            const userSignatureBytes = Buffer.from(signatureHex.signature.replace('0x', ''), 'hex')

            // Get public key from wallet
            const walletObj = movementWallet as any
            let publicKeyBytes = Buffer.from(walletObj.publicKey.replace(/^0x/, ''), 'hex')
            if (publicKeyBytes.length === 33) publicKeyBytes = publicKeyBytes.slice(1)

            const authenticator = new AccountAuthenticatorEd25519(
                new Ed25519PublicKey(publicKeyBytes),
                new Ed25519Signature(userSignatureBytes)
            )

            const pendingTxn = await aptos.transaction.submit.simple({
                transaction,
                senderAuthenticator: authenticator,
            })

            await aptos.waitForTransaction({ transactionHash: pendingTxn.hash })

            toast.dismiss()
            toast.success("Gift claimed successfully!")
            fetchPublicGifts()

        } catch (e: any) {
            console.error(e)
            toast.dismiss()
            toast.error(e.message || "Claim failed")
        } finally {
            setClaimingId(null)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        Explore Gifts 🎁
                    </h1>
                    <p className="text-gray-400">Discover and claim public gifts from the community</p>
                </div>

                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                            <Plus className="h-4 w-4 mr-2" /> Create Gift
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[600px] bg-gray-900 border-gray-800">
                        <DialogHeader>
                            <DialogTitle className="text-white">Create Public Gift</DialogTitle>
                            <div className="text-sm text-gray-400">
                                Create a gift card that anyone can discover and claim based on requirements.
                            </div>
                        </DialogHeader>
                        <CreateExploreGift
                            onSuccess={() => {
                                setCreateOpen(false)
                                fetchPublicGifts()
                            }}
                        />
                    </DialogContent>
                </Dialog>
            </div>

            {/* Gifts Grid */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-12 w-12 animate-spin text-purple-400" />
                </div>
            ) : gifts.length === 0 ? (
                <Card className="text-center py-16 bg-white/5 border-white/10">
                    <CardContent>
                        <Gift className="h-16 w-16 mx-auto text-gray-500 mb-4" />
                        <h3 className="text-xl font-medium mb-2 text-white">No public gifts yet</h3>
                        <p className="text-gray-500 mb-6">Be the first to create one!</p>
                        <Button
                            onClick={() => setCreateOpen(true)}
                            className="bg-gradient-to-r from-purple-600 to-pink-600"
                        >
                            <Plus className="h-4 w-4 mr-2" /> Create Gift
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {gifts.map((gift) => (
                        <div key={gift.id} className="group relative">
                            <div className="transform transition-all duration-300 group-hover:-translate-y-1">
                                <GiftCardPreview
                                    amount={gift.amount}
                                    token={gift.tokenType}
                                    recipient="Public"
                                    senderName={gift.fromName || "Anonymous"}
                                    message={gift.message}
                                    themeId={gift.themeId || "modern"}
                                    logoUrl={gift.logoUrl}
                                    size="card"
                                />
                            </div>

                            {/* Overlay with info */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-xl backdrop-blur-sm p-4">
                                {gift.claimed ? (
                                    <span className="bg-gray-800 text-white px-4 py-2 rounded-full font-bold">
                                        Claimed
                                    </span>
                                ) : (
                                    <>
                                        <div className="text-center mb-4 text-white">
                                            <p className="text-sm text-gray-300 mb-1">Requires:</p>
                                            <p className="font-semibold">{getSocialLabel(gift.requiredSocials)}</p>
                                        </div>
                                        <Button
                                            onClick={() => handleClaim(gift)}
                                            disabled={!!claimingId}
                                            className="bg-white text-black hover:bg-gray-100 w-full"
                                        >
                                            {claimingId === gift.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <Sparkles className="h-4 w-4 mr-2" />
                                            )}
                                            Claim Gift
                                        </Button>
                                    </>
                                )}
                                <p className="text-xs text-gray-400 mt-3">
                                    Created {formatDistanceToNow(gift.createdAt * 1000, { addSuffix: true })}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
