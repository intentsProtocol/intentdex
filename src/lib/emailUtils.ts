import { type ThemeConfig } from "./themeRegistry"

// Email clients have poor CSS support, so we map our themes to safe inline styles/hex codes
const THEME_EMAIL_STYLES: Record<string, { bg: string, text: string, accent: string, button: string }> = {
    modern: {
        bg: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
        text: "#ffffff",
        accent: "#ddd6fe",
        button: "#ffffff"
    },
    ocean: {
        bg: "linear-gradient(135deg, #06b6d4 0%, #2563eb 100%)",
        text: "#ffffff",
        accent: "#cffafe",
        button: "#ffffff"
    },
    christmas: {
        bg: "linear-gradient(135deg, #dc2626 0%, #14532d 100%)",
        text: "#fef2f2",
        accent: "#facc15",
        button: "#ffffff"
    },
    newyear: {
        bg: "linear-gradient(135deg, #0f172a 0%, #581c87 100%)",
        text: "#ffffff",
        accent: "#a5b4fc",
        button: "#ffffff"
    },
    thanksgiving: {
        bg: "linear-gradient(135deg, #ea580c 0%, #78350f 100%)",
        text: "#fff7ed",
        accent: "#fde68a",
        button: "#ffffff"
    },
    birthday: {
        bg: "linear-gradient(135deg, #ec4899 0%, #eab308 100%)",
        text: "#ffffff",
        accent: "#fef08a",
        button: "#ffffff"
    },
    love: {
        bg: "linear-gradient(135deg, #fb7185 0%, #9333ea 100%)",
        text: "#fff1f2",
        accent: "#fce7f3",
        button: "#ffffff"
    },
    wedding: {
        bg: "linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)",
        text: "#1e293b",
        accent: "#64748b",
        button: "#ffffff"
    },
    gold: {
        bg: "linear-gradient(135deg, #ca8a04 0%, #a16207 100%)",
        text: "#fefce8",
        accent: "#fde047",
        button: "#ffffff"
    },
    cyberpunk: {
        bg: "linear-gradient(135deg, #0f172a 0%, #701a75 100%)",
        text: "#22d3ee",
        accent: "#e879f9",
        button: "#22d3ee"
    },
    formatted: { // Fallback
        bg: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        text: "#fcd34d",
        accent: "#f59e0b",
        button: "#fcd34d"
    }
}

interface EmailDetails {
    amount: string
    token: string
    recipient: string
    senderName?: string
    message?: string
    txHash: string
    claimUrl: string
}

export const generateEmailHtml = (details: EmailDetails, theme: ThemeConfig) => {
    // Get specific styles or fallback
    const styles = THEME_EMAIL_STYLES[theme.id] || THEME_EMAIL_STYLES.formatted

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You received a Gift!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
            <td align="center" style="padding: 40px 0;">
                
                <!-- Main Card Container -->
                <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="background: ${styles.bg}; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
                    
                    <!-- Header / Icon -->
                    <tr>
                        <td align="center" style="padding: 40px 0 20px 0;">
                            <div style="background: rgba(255,255,255,0.2); border-radius: 50%; width: 64px; height: 64px; text-align: center; line-height: 64px;">
                                <span style="font-size: 32px;">🎁</span>
                            </div>
                        </td>
                    </tr>

                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 0 40px;">
                            <h1 style="color: ${styles.text}; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">
                                You Received a Gift!
                            </h1>
                            ${details.senderName ?
            `<p style="color: ${styles.accent}; margin: 10px 0 0 0; font-size: 16px;">from <strong>${details.senderName}</strong></p>`
            : ''}
                        </td>
                    </tr>

                    <!-- Amount -->
                    <tr>
                        <td align="center" style="padding: 40px 0;">
                            <div style="font-size: 56px; font-weight: 800; color: ${styles.text}; letter-spacing: -1px;">
                                ${details.amount} <span style="font-size: 28px; opacity: 0.9;">${details.token}</span>
                            </div>
                        </td>
                    </tr>

                    <!-- Message -->
                    ${details.message ? `
                    <tr>
                        <td align="center" style="padding: 0 60px;">
                            <div style="background: rgba(0,0,0,0.1); border-radius: 12px; padding: 20px; color: ${styles.text}; font-style: italic; font-size: 16px; line-height: 1.5;">
                                "${details.message}"
                            </div>
                        </td>
                    </tr>
                    ` : ''}

                    <!-- CTA Button -->
                    <tr>
                        <td align="center" style="padding: 40px;">
                            <a href="${details.claimUrl}" style="background-color: ${styles.button}; color: #000000; text-decoration: none; padding: 16px 32px; border-radius: 100px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                                Claim Your Gift
                            </a>
                        </td>
                    </tr>

                    <!-- Footer Info -->
                    <tr>
                        <td align="center" style="padding: 20px; background: rgba(0,0,0,0.1); color: ${styles.accent}; font-size: 12px;">
                            <p style="margin: 0;">Tx Hash: ${details.txHash.slice(0, 10)}...${details.txHash.slice(-8)}</p>
                            <p style="margin: 5px 0 0 0; opacity: 0.8;">Powered by Move GiftCards</p>
                        </td>
                    </tr>

                </table>

                <!-- Bottom Text -->
                <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
                    Ensure you have a compatible wallet installed to claim.
                </p>

            </td>
        </tr>
    </table>

</body>
</html>
    `.trim()
}
