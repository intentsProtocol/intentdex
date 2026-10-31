# Design system

The wallet's look is "Morphic": emerald on near-black (or on a cool off-white), soft meshes, translucent glass surfaces. It came from the prototypes in `devrel-agent-context/wdk-wallet/wallet-extension-bundle/` and lives in three files:

| File | Holds |
|---|---|
| `src/design-system/theme.css` | Token values for each theme, surface sizing, keyframes, focus and scrollbar styles |
| `src/design-system/primitives.tsx` | The `MX` token map, `glass()`, and every shared component |
| `src/design-system/Chameleon.tsx` | Cham |

## The one rule

**A screen never contains a literal colour.** It uses `MX.something`. If the colour you need does not exist, add a variable to `theme.css` with a value under *both* `[data-theme='dark']` and `[data-theme='light']`, and a key in `MX`.

Screens use inline styles (a project rule, for portability between the prototype bundle and this codebase). Because `MX` values are `var(--mx-…)` strings, inline styles follow the theme without any re-render logic.

Exceptions, on purpose: the primary button's gradient and its text colour are fixed (emerald with near-black text reads well on both themes), QR codes are always black on white (scanners need it), and avatar gradients are per-account colours.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Brand | `primary`, `primaryStrong`, `onPrimary`, `primaryDim`, `primaryBorder`, `primarySoft`, `primaryGlow` | Accents, active states, positive values |
| Background | `bg0` (page), `bg1` (card), `bg2` (input, chip), `bg3` | Solid surfaces |
| Text | `fg`, `fgMute`, `fgFaint` | Primary, secondary, tertiary |
| Lines | `border`, `borderStrong` | Dividers, outlines |
| Tints | `surface`, `surface2` | A faint fill over whatever is behind: rows, hover |
| Glass | `glass`, `glassStrong`, `glassBorder`, `glassHi`, `shadow`, `scrim` | See below |
| Status | `amber*`, `red*` (each with `Dim` and `Border`) | Warning, error |
| Chains | `CHAIN.bch`, `.eth`, `.sol`, `.btc`, `.bnb`: `color`, `bg`, `border` | Per-chain accents; `bg` and `border` are `color-mix` tints of `color` |
| Type | `MX.mono` | Addresses, hashes, derivation paths |

In light mode `primary` is a darker emerald (27% lightness against 41%) so it passes contrast as text on white, and the chain colours shift darker for the same reason.

## Themes

`data-theme` on `<html>` is `dark` or `light`. The preference (`system`, `light`, `dark`) is in settings; `SettingsProvider` resolves `system` with `prefers-color-scheme` and follows OS changes live. `main.tsx` sets the attribute before React loads so the first paint is already right.

## Liquid glass

`glass(strong?)` returns the style for a translucent surface: a semi-transparent fill, `backdrop-filter: blur(22px) saturate(180%)`, a hairline border, and an inset top highlight that reads as a lit edge.

Used where a surface floats over content: the top bar, the bottom navigation, sheets (strong variant), and the portfolio and swap cards (`<Bento glassy>`). The page's mesh gradient and noise sit behind, which is what gives the glass something to refract.

Use it sparingly. List rows and detail cards are solid or `surface`-tinted; glass on everything turns to mud and costs frames.

## Surfaces and layout

`data-surface` on `<html>`: `panel`, `popup` or `tab`. `MPopup`, the root of every screen, fills its container, and `theme.css` sizes the container:

- `popup`: 360 × 600, the only fixed size.
- `panel`: the full panel, minimum 320 wide. Screens must work from 320 to about 500 wide: no fixed widths, `minWidth: 0` on anything that should shrink, ellipsis on names and addresses.
- `tab`: a centred card up to 420 × 720 on a mesh background.

A screen is a column: a header (`MTopBar` or `PageHeader`), a scrolling middle (`flex: 1; overflow: auto; minHeight: 0`), and a pinned footer for its main action.

## Components

| Component | For |
|---|---|
| `MPopup` | Screen root: background, mesh, noise |
| `MPrimary`, `MSecondary`, `IconBtn` | Buttons. `loading` shows a spinner and disables. One primary per screen. |
| `MInput` | Text input with focus ring, `invalid`, prefix and suffix slots |
| `Segmented`, `Switch` | Choice of a few; on/off |
| `Bento` | Card; `glassy`, `glow`, `mesh` variants |
| `Sheet` | Bottom (or top) sheet with scrim; closes on Escape and scrim click |
| `Banner` | Inline message: `info`, `warn`, `error`, `success` |
| `TokenIcon` | Token logo with its network's logo in the corner; falls back to initials |
| `ChainGlyph`, `ChainStack`, `ChainBadge` | Chain marks |
| `Skeleton`, `Spinner`, `LiveDot` | Loading and liveness |
| `MQR` | A real QR code (`qrcode-generator`) |
| `MI.*` | Icons: 24-unit stroke icons, `currentColor` |
| `useCopy` | Copy with a "copied" state that resets |

In `screens/shared.tsx`: `MTopBar` (account switcher, network pill, lock), `PageHeader`, `MBottomNav`, `QA`, `Label`, `DetailCard` / `DetailRow`, `EmptyState`, `Avatar`, `NetworkPill`.

## States every screen handles

- **Loading:** skeleton rows where a list will be; a spinner inside the button that was pressed.
- **Empty:** `EmptyState` with one sentence and, where it helps, one action.
- **Error:** a `Banner` next to what failed, saying what to do. Errors from libraries pass through `errorMessage()` so the user never sees a stack trace.
- **Stale:** a balance that could not be refreshed stays on screen with a banner naming the chain.

## Accessibility

- Every interactive element is a `<button>`, `<a>` or form control; icon-only buttons have an `aria-label`.
- `:focus-visible` outline on everything, from `theme.css`.
- Sheets are `role="dialog"` and close on Escape. Banners are `role="status"`, or `role="alert"` for errors.
- `prefers-reduced-motion` turns animations off globally.
- Hit targets are at least 26 px in bars and 34 px in lists. That is small for touch; the wallet is a desktop extension.

Not done: a focus trap inside sheets, and a full screen-reader pass.

## Cham

`<Chameleon size tone mood track />`

- **`tone`** is any CSS colour; the body, belly, stripes and eye ring are `color-mix` shades of it and cross-fade over 700 ms. The welcome screen changes it as you hover the chain rows; the send success screen uses the asset's chain colour.
- **`mood`:** `idle` (blinks, sways), `shy` (eye shut: shown while a password or phrase is being typed), `happy` (tongue flick: unlock, sent, done), `error` (head shake), `busy` (tail spiral turns).
- **Eye tracking:** the pupil moves toward the pointer, up to 5.5 units, updated once per animation frame.

Pure SVG and CSS keyframes; no animation library, no image assets.

Where Cham appears: welcome, password, confirm, import, done, unlock, booting, send success, password gates in settings, about. Not on working screens (home, swap, activity): a mascot on every screen stops being noticed.
