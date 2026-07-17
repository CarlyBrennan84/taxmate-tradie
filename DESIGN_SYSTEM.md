# Glovebox Design System

**Status:** Source of truth. Every screen built from this point forward references this document.
**Scope:** This documents what is *actually built* in `src/App.tsx` today, plus the rules for extending it consistently. It does not propose a redesign — see [§10 Implementation Audit](#10-implementation-audit--future-design-rules) for the handful of inconsistencies found and how to close them without changing how anything looks.

---

## 1. Design Principles

### What Glovebox is
An Australian tax assistant for apprentices and tradies. It should feel like a personal tax assistant in your pocket — not accounting software.

**Feels like:** Apple Wallet. Premium, Australian, helpful, modern, fast, confident.
**Never feels like:** MYOB/Xero, government portals, spreadsheets, enterprise software.

### One question per screen
Every screen exists to answer exactly one question. If an element doesn't help answer it, it doesn't belong on that screen.

| Screen | Question it answers |
|---|---|
| Dashboard (Home) | "What should I do today?" |
| Scan Receipt | "Take the photo." |
| Receipt Details | "Is this correct?" |
| Logbook | "Am I on track?" |
| Deductions | "Where is my refund coming from?" |
| Benefits | "What money am I still missing?" |
| Ask Glovebox | "How can I help?" |
| Settings | "How is my app configured?" |

Whitespace is a feature. When adding something to a screen, ask which question it serves — if the answer is "none," it goes in Settings, a Disclosure, or nowhere.

---

## 2. Colour System

Glovebox runs **two surface modes** side by side today: a light mode (Home's body content, Deductions' receipt list card contents, Settings, Progress, Accountant Pack) and a dark "premium" mode (Home's hero, Scan Receipt, Log Trip, Logbook, Deductions dashboard). Both are documented below — see §10 for why this split exists and how to close the gap.

### Light surface tokens (exported from App.tsx)

| Token | Hex | Usage |
|---|---|---|
| `NAVY` | `#010818` | Primary text on light surfaces, primary headings, exact-matched to the logo's own background |
| `NAVY_SOFT` | `#3A4A66` | Secondary text on light surfaces (labels, field captions) |
| `TEAL` | `#2563FF` | Primary brand blue — primary buttons, active states, links, progress fill |
| `TEAL_DARK` | `#1E4FBE` | Text/icons that sit on `TEAL_TINT` (passes AA contrast where flat `TEAL` would not) |
| `TEAL_TINT` | `#E9EFFE` | Light blue backgrounds behind icons, selected pills, highlighted rows |
| `GREEN` | `#18C37E` | Success/positive-delta icons and graphic elements only |
| `GREEN_DARK` | `#0E7A52` | Success/positive-delta **text** — `GREEN` fails AA contrast as text on `GREEN_TINT` (~2.1:1); `GREEN_DARK` passes (~4.9:1) |
| `GREEN_TINT` | `#E4F9F0` | Light green backgrounds behind success badges |
| `AMBER` | `#C77F1A` | Warning icons, "needs attention" indicators |
| `AMBER_TINT` | `#FBF0DE` | Light amber backgrounds behind warning pills |
| `GREY_LINE` | `#E7E9EE` | Borders, dividers on light surfaces |
| `GREY_BG` | `#F6F7F9` | Page background behind light-surface content |
| *(inline)* | `#8A93A3` | Muted/tertiary text on light surfaces (receipt dates, helper captions) — **not currently a named export; see §10** |
| *(inline)* | `#5B6472` / `#B7BEC9` | Secondary icon colour / disabled icon colour on light surfaces |
| *(inline)* | `#D64545` | Notification dot (bell badge) |

### Dark surface tokens (currently inline hex — not yet named exports)

| Colour | Hex | Usage | Occurrences |
|---|---|---|---|
| Page background | `#081425` | Full-bleed background for dark screens (Logbook, Deductions, Scan Receipt, Log Trip) | 5 |
| Card surface | `#0D1B2E` | Standard card background on dark screens | 27 |
| Card border | `rgba(255,255,255,0.08)` | Standard card border on dark screens | 30 |
| Elevated surface | `#14233A` | Insight cards, input fields, dropdown menus — one step lighter than a standard card, for emphasis or interactive surfaces | 14 |
| Secondary text | `#AEB9CB` | Body copy, field labels on dark screens | 24 |
| Muted text | `#79879C` | Captions, timestamps, sub-labels on dark screens | 35 |
| Border (emphasis) | `rgba(255,255,255,0.10)`–`rgba(255,255,255,0.14)` | Card/button borders that need slightly more contrast than the default `0.08` | 18 |
| Divider | `rgba(255,255,255,0.06)`–`rgba(255,255,255,0.08)` | Row separators inside dark list cards | — |

`TEAL`, `GREEN`, `AMBER` and their `rgba(37,99,255,0.12–0.15)` / `rgba(24,195,126,0.15)` translucent tints carry over unchanged into dark mode — they're the one part of the palette already shared correctly between both surfaces.

### Charts & data visualisation
- Line/area graphs (`TrendSparkline`): stroke `TEAL` (or passed colour) at 2px, gradient fill from 35% opacity to 0%, final data point emphasised at 3.5px radius vs 2px for others.
- Progress rings (`RadialProgress`): 7px stroke, round linecap, track at `rgba(255,255,255,0.10–0.2)` on dark / theme-appropriate track on light.
- Progress bars (`AnimatedBar`): 8px height (`h-2`), full rounded, track colour is a prop (defaults to light `#EEF0F4` — **must be explicitly overridden to a dark-appropriate value when placed on a dark card**, see §10).

### Notification badges
- Dot badge: 8px circle, `#D64545`, positioned top-right of an icon with a 1–2px offset.
- Count badge (e.g. Review Day tab): min 18px circle, `TEAL` fill (or `rgba(255,255,255,0.25)` when the parent tab is already active), white bold text at 10px.

---

## 3. Typography

**Typeface:** Inter, loaded via Google Fonts, weights 400/500/600/700/800. No secondary typeface — display, body and numerals all use Inter (numerals get `.tabular` — `font-variant-numeric: tabular-nums` — wherever a number changes or sits in a table/list so digits don't jitter widths).

Real scale in use today (measured from the codebase, not aspirational):

| Role | Class | Size | Weight | Where used |
|---|---|---|---|---|
| Metric / Hero number | `text-4xl` | 36px | `font-bold` | Hero card totals ("$2,841", "$1,249") |
| Page title | `text-2xl` | 24px | `font-bold` | Tab page headings (light-mode "Deductions" style pages) |
| Screen title | `text-xl` | 20px | `font-bold` | Dark screen headers ("Logbook", "Deductions") |
| Section title | `text-lg` | 18px | `font-semibold` | `SectionTitle` heading, card group headers |
| Body | `text-sm` | 14px | `font-medium`/`font-semibold` | Default body text, list rows, buttons, field values — the workhorse size (98 occurrences) |
| Caption | `text-xs` | 12px | `font-medium` | Secondary/helper text, sub-labels, badges (91 occurrences) |
| Micro-label | `text-[11px]` / `text-[10px]` | 11px / 10px | `font-medium`/`font-semibold` | Percentages, timestamps, eyebrow labels, badge text — smallest legible size in the app |

**Weights:** `font-medium` (labels, secondary emphasis), `font-semibold` (buttons, section titles, list-row primary text), `font-bold` (page titles, metrics, greetings). Plain `font-normal` is essentially unused — Glovebox's type is confident, not neutral.

**Letter spacing:** only on eyebrow/overline labels — `tracking-wide uppercase` at `text-[11px] font-semibold`, always in `TEAL_DARK` (light) or `TEAL` (dark).

**Truncation & wrapping rules:**
- Single-line list content (vendor names, category labels, trip purposes) → `truncate`, never wrap.
- Card labels and captions → allowed to wrap to 2 lines max; use `leading-relaxed` for anything longer than one line.
- Numbers/currency never truncate or wrap — if a metric card is too narrow, the number shrinks (`text-2xl` → `text-lg`) before it's allowed to clip.

**Emphasis:** colour and weight do the work, not italics or underlines (neither appears anywhere in the app). A value that needs to stand out gets `GREEN_DARK`/`TEAL` + `font-bold`, not decoration.

---

## 4. Spacing, Radius & Shadow

### Spacing scale
Glovebox uses Tailwind's default spacing scale, but only a subset of stops appear in practice. Treat this as the *actual* app scale — don't introduce a value outside it without a reason:

| Token | Px | Use |
|---|---|---|
| `1` | 4px | Icon-to-label gaps, tight badge padding |
| `1.5`–`2` | 6–8px | Gap between stacked micro-elements (label + value) |
| `3` | 12px | Gap between icon and text in a row; small card padding |
| `4` | 16px | **Default gap/padding unit** — card internal padding, gap between grid items, screen edge padding on mobile |
| `5`–`6` | 20–24px | Card padding for hero/emphasis cards; gap between major stacked sections |
| `8` | 32px | Large section breaks (rare) |

Rule of thumb: `gap-3`/`p-3` for compact list rows, `gap-4`/`p-4` for standard cards, `p-5`/`p-6` for hero cards that need to breathe. Screen-edge padding is `px-4` on mobile, stepping up via `sm:px-6 lg:px-10` on wider viewports.

### Border radius

| Radius | Value | Use | Frequency |
|---|---|---|---|
| `rounded-full` | 9999px | Buttons (pill), FABs, avatars/icon circles, badges, segmented-control thumb | 52 |
| `rounded-2xl` | 16px | **Default card radius** — every standard card, both light and dark | 43 |
| `rounded-xl` | 12px | Inputs, small buttons, icon containers, dropdown menus | 43 |
| `rounded-lg` | 8px | Small icon badges (9×9 icon containers), logo corners | 16 |
| `rounded-3xl` | 24px | Hero cards only — Home's greeting card, full-bleed screen headers | 4 |

If you're placing a new element and unsure which radius: icon container → `rounded-lg`; button/input/small interactive element → `rounded-xl`; card → `rounded-2xl`; anything full-bleed/hero → `rounded-3xl`; anything pill-shaped or circular → `rounded-full`.

### Shadow
Glovebox uses shadow sparingly — two tokens cover almost everything:

```
shadow-card:       0 1px 2px rgba(19,32,56,0.04), 0 8px 24px -12px rgba(19,32,56,0.10)
shadow-card-hover:  0 2px 4px rgba(19,32,56,0.06), 0 16px 32px -12px rgba(19,32,56,0.16)
```

- `shadow-card` on every light-mode `Card` at rest, transitioning to `shadow-card-hover` on hover/press.
- FABs and the bottom-sheet nav drawer use `shadow-card-hover` directly (already "elevated").
- Dark-mode cards use **no shadow** — separation comes from the `#0D1B2E` surface against `#081425` background plus the 1px `rgba(255,255,255,0.08)` border, not elevation. Adding a shadow to a dark card is a mistake, not a style choice.
- One bespoke shadow exists for the Log Trip floating "+" button: `0 8px 24px -4px rgba(37,99,255,0.55)` — a tinted glow instead of a neutral shadow, because it sits on a dark background where a neutral shadow wouldn't read. Use this pattern (tinted glow, colour-matched to the button) for any FAB placed on a dark screen.

Never stack more than one shadow level on a single element, and never use shadow to fake a border — use the actual border token.

---

## 5. Components

### Icons
- **Library:** [lucide-react](https://lucide.dev) exclusively — 40 icons currently imported, no other icon set anywhere in the app.
- **Style:** outlined only. Glovebox never uses filled icons — even "active" states are communicated with colour/background (a tinted circle behind the icon), not a filled icon variant.
- **Sizes:** `13`/`14`/`15`/`16` for inline/row icons, `18`/`19`/`20` for nav and header icons, `22` for empty-state icons. There's no formal "icon size scale" beyond "smaller in dense rows, larger in headers/empty states" — when in doubt, `16` is the safe default for a row and `20` for a header.
- **Colour:** icons are never left at default black — they always take either the surrounding text colour, `TEAL`/`TEAL_DARK` (default interactive icon colour), or a semantic colour (`GREEN`/`AMBER`/error red) matching what they represent.

### Buttons

| Variant | Look | Example |
|---|---|---|
| **Primary** | Solid `TEAL` fill, white text, `rounded-xl`, `font-semibold`, `hover:brightness-110` | "Log Trip", "Save Trip", "Add now" |
| **Secondary** | Transparent/outlined, 1px border (`GREY_LINE` light / `rgba(255,255,255,0.14)` dark), theme text colour | "Export CSV", filter chips (unselected) |
| **Ghost/text** | No fill, no border, `TEAL`/`TEAL_DARK` text, used for low-emphasis navigation ("View all trips", "Learn more") | Card header links |
| **Icon button** | Circular, transparent or `rgba(255,255,255,0.08)`/`#0D1B2E` fill, icon only, 40×40px min | Filter icon, settings gear, delete (trash) |
| **FAB** | 56×56px (`w-14 h-14`) circle, `TEAL` fill, white icon, positioned `right-4 sm:right-6 bottom-20 lg:bottom-6`, `shadow-card-hover` (light) or tinted glow (dark) | Scan/Log Trip quick-action, Log Trip's Add Trip button |
| **Segmented control** | Full-width grid, `rounded-2xl` outer container at `#0D1B2E`/`rgba(255,255,255,0.05)`, `rounded-xl` selected pill in `TEAL` | Manual Entry/Auto Tracking, Overview/Trips/Review Day |

**States:**
- *Disabled:* `disabled:opacity-50 disabled:cursor-not-allowed` — never removed from layout, never recoloured, just faded.
- *Pressed:* `active:scale-95` on FABs and primary CTAs that warrant tactile feedback; standard buttons rely on `hover:brightness-110`/`hover:brightness-95` alone.
- *Loading:* spinner (`Loader2` icon, `animate-spin`) replaces the label text inline — e.g. "Calculating…" — button stays the same size, never collapses to icon-only.
- All buttons: `transition` class present so colour/transform changes animate rather than snap.

### Cards
One structural card, several content patterns — not eight different card components:

- **Base card** (light): `Card` component — white, `rounded-2xl`, `border-[#E7E9EE]`, `shadow-card`, `fade-up` entrance, optional `delay` prop for staggered lists.
- **Base card** (dark): no shared component yet (see §10) — inline `{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }` on a `rounded-2xl` div.
- **Hero card:** `rounded-3xl`, full-bleed on mobile via negative margins (`-mx-4 sm:-mx-6 lg:mx-0`), `p-5`–`p-6`. One per screen, at the top.
- **Metric card:** compact card, label (`text-xs`, muted) → big number (`text-2xl`/`text-4xl`, bold) → optional delta/trend line underneath.
- **Insight/AI card:** `#14233A` (dark) or `TEAL_TINT` (light) background, `Sparkles` icon in a tinted circle on the left, message text, optional action button/link on the right. Always the same left-icon/message/action anatomy regardless of what it's suggesting.
- **List-row card:** icon (tinted circle, `rounded-lg`) → title + caption (`min-w-0 flex-1 truncate`) → trailing value/badge → chevron. This exact anatomy is reused for receipts, trips, categories, and settings rows.

Padding: `p-4`–`p-5` for standalone cards, `p-2 sm:p-4` for cards that wrap a list (list rows carry their own `px-2`/`px-4` internal padding so the outer card padding stays light).

### Inputs
- **Text field:** `inputCls`/`darkInputCls` shared class strings — `rounded-xl`, 1px border, `px-3 py-2`, `text-sm`, focus ring in `TEAL`. Every text input in the app uses one of these two strings, never a bespoke input style.
- **Toggle/switch:** custom-built (not a native checkbox) — 44×24px track, `TEAL` when on / `rgba(255,255,255,0.14)` when off, 20px white thumb that slides with `transition-all`. Used for Round Trip, and anywhere else a binary on/off makes more sense than a checkbox.
- **Slider:** native `<input type="range">` with `accentColor: TEAL` — used once (Mixed classification %).
- **Segmented control:** see Buttons above — this is Glovebox's substitute for a dropdown/select wherever the option set is small (2–3 items) and always visible.
- **Autocomplete/suggestions:** dropdown list positioned `absolute … top-full mt-1`, `rounded-xl`, dark elevated surface (`#14233A`), each suggestion row `px-3 py-2.5` with a leading icon.
- **Date:** native `<input type="date">`, styled via `inputCls`, no custom calendar UI.
- **Validation/error state:** not yet a formal pattern — currently expressed via inline `AMBER` helper text below the field (e.g. distance-lookup errors) rather than a red error colour + border. Treat `AMBER` as "needs your attention," not built-in red/destructive validation.

### Lists
- **Row height:** roughly 56–72px depending on whether a caption line is present (`py-3` standard, `py-3.5` in Deductions category rows).
- **Chevron:** every navigable list row ends in a `ChevronRight` at `size={13-15}`, muted colour (`#B7BEC9` light / `#3A4A66` dark). Rows that are informational only (no navigation) omit it.
- **Dividers:** `border-b last:border-0` between rows inside a card — never a divider after the final row, never a divider around the whole list (the card border handles that).
- **Swipe actions:** not implemented anywhere — destructive actions (delete) are an explicit trash-can icon button at the end of the row instead. Keep it this way; don't introduce swipe-to-delete on some screens and not others.

---

## 6. Motion & Haptics

### Motion system
| Pattern | Implementation | Timing |
|---|---|---|
| Card/section entrance | `.fade-up` utility class — opacity 0→1 + `translateY(8px)→0` | 500ms, `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out, slight overshoot-free deceleration) |
| Staggered list entrance | Same `.fade-up`, driven by a `delay` prop (`animationDelay`) in ~40ms steps per item | 40ms stagger |
| Progress bar/ring fill | Width or `stroke-dashoffset` transition, starts after a 120ms mount delay so it visibly animates rather than appearing pre-filled | 700ms |
| Number count-up | `AnimatedNumber` — animates the numeric value itself, not just opacity | 700ms default |
| Button press | `active:scale-95` | instant, via CSS `transition` |
| Hover | `hover:brightness-110` (fills) / `hover:brightness-95` (light fills) | CSS default transition |
| Segmented control | Selected pill background swaps instantly (colour, not position-sliding) via conditional `style` | — |
| Screen-level navigation | No custom page-transition system — tab switches are instant (state swap), full-screen overlays (Log Trip, Scan Capture) mount via `fixed inset-0` with their own internal `fade-up` on content | — |

**Principle:** motion confirms state changes (something loaded, something completed, something is selected) — it never delays the user or exists purely for decoration. Everything above 500ms is reserved for a genuine loading wait, never for ambient animation. This is what "feels like native iOS" means in practice here: fast, purposeful, no bounce/wobble for its own sake.

### Haptics
`navigator.vibrate(10)` — a single short pulse — fires on:
- Saving a trip (Log Trip's Save button)

This is the only haptic call in the app today. It's a progressive enhancement (no-op on iOS Safari, which doesn't support the Vibration API) — never rely on it as the only feedback for an action; it always accompanies a visual confirmation (the success screen), never replaces one.

**Rule for new features:** add a haptic pulse to the same category of action — a save/confirm that produces persisted data (trip saved, receipt saved, expense added) — not to every button press. Reserve it for moments that deserve a "that's done" feeling.

---

## 7. Accessibility & Responsiveness

### Contrast
Every colour pairing in this document has been chosen (or corrected) for AA contrast — the `GREEN`/`GREEN_DARK` split exists specifically because flat `GREEN` text on `GREEN_TINT` measured ~2.1:1 (fails AA) while `GREEN_DARK` measures ~4.9:1 (passes). Apply the same discipline to any new semantic colour: **never use the same hex for both a tinted background and text on top of it** — always create a `_DARK`/adjusted pairing and verify contrast before shipping.

### Tap targets
Icon buttons are built at 40×40px minimum (`w-10 h-10`), FABs at 56×56px. List rows have generous vertical padding (`py-3`+) specifically so the whole row — not just the text — is tappable (`role="button" tabIndex={0}` with keyboard `Enter`/`Space` handling on custom rows like `ReceiptRow`).

### Safe areas
`env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`, always wrapped in `max(Npx, env(...))` so there's a sane minimum on devices without a notch/home-indicator. Applied to: full-screen overlay headers/footers (Log Trip, Scan Capture), and should be applied to any future full-screen (`fixed inset-0`) component the same way.

### Dynamic Type / VoiceOver
Not yet explicitly tested or hardened — this is a real gap, not a documented pattern (see §10). Icons that carry meaning without adjacent text (e.g. the bell notification dot) should get an `aria-label` or `aria-hidden` treatment; most currently don't.

### Responsiveness
The app is mobile-first with a `lg:` breakpoint (1024px) that switches from a bottom-nav mobile layout to a persistent left sidebar + no bottom nav. There is no dedicated tablet-specific layout — `sm:` adjustments (padding, some `sm:right-6` FAB offsets) smooth the transition between phone and the `lg:` sidebar layout, but the phone layout itself isn't tuned per-device (SE vs Pro Max) beyond being fluid/relative. Trust flex/grid + `min-w-0`/`truncate` over fixed widths, and this holds up fine from SE to Pro Max without special-casing.

---

## 8. AI Writing Guide & Microcopy

### Glovebox AI's tone
Friendly, Australian, plain-English, always ends on the next action — never a lecture, never a technical status report.

| Don't | Do |
|---|---|
| "You have not configured vehicle deductions." | "Looks like we haven't set up your vehicle yet. Let's do that now." |
| "Invalid input: distance lookup failed." | "Couldn't calculate distance." / "Distance lookup failed — check your connection." |
| "Configuration error." | "Accounts aren't set up yet." |
| "No data available." | "No trips logged yet. Tap Log Trip above…" |

### Microcopy rules by context
- **Buttons:** verb-first, 1–3 words, no punctuation. "Log Trip," "Save Trip," "Add now," "Calculate distance." Never "Submit" or "OK."
- **Headings:** short noun phrases, sentence case, no colons. "Recent trips," not "Recent Trips:" or "Your Recent Trip History."
- **Errors:** state what happened + what to do, in one sentence, no jargon, no error codes surfaced to the user. "Couldn't find a route between those addresses — try being more specific."
- **Empty states:** always pair a plain statement with the action that fixes it. "No trips logged yet" + "Tap Log Trip above, or import a Driversnote CSV to backfill your history." Never just "No data."
- **Success:** short, present-tense, specific. "Trip Saved," "Updated." — confirms what happened, doesn't over-celebrate.
- **Tips/insights:** framed as help, not instruction — "You're ahead with the logbook method!" not "Logbook method is more optimal." Always end with a next step where one exists ("Keep logging to maximise your deduction").
- **Numbers in copy:** always formatted (`fmt`/`fmtDec` — `$1,249`, not `1249` or `$1249.00` unless cents genuinely matter, e.g. dollar amounts in the receipt-detail context).

**The test for any new string:** would a tradie mate say this out loud to you, or does it sound like it came from a compliance document? If the latter, rewrite it.

---

## 9. Screen Blueprints

Every primary screen shares this structural spine:

```
┌─────────────────────────────┐
│ Header (icon + title + sub) │  ← identifies the screen, always top-left title / top-right single action
├─────────────────────────────┤
│ Hero card (if applicable)   │  ← the ONE number/status that answers the screen's question
├─────────────────────────────┤
│ Supporting cards / lists    │  ← everything that supports or explains the hero
├─────────────────────────────┤
│ Secondary/insight card      │  ← optional AI nudge or next action
├─────────────────────────────┤
│ Full list (if applicable)   │  ← the detailed, scrollable record
└─────────────────────────────┘
      [FAB, bottom-right, if the screen has one primary add action]
```

| Screen | Header | Hero | Supporting | List |
|---|---|---|---|---|
| **Dashboard/Home** | Logo + bell (full-bleed navy) | Greeting + quick actions | Quick setup / Today's Tasks | Readiness checklist |
| **Logbook** | Icon mark + "Logbook" + subtitle, settings icon | Today's driving (ring) | 3 metric cards + insight | Recent trips → full Trips tab |
| **Scan Receipt** | Back + title + lightning icon | Capture viewfinder | Corner guides, tips | — |
| **Receipt Details** | "Receipt Details" | Live AI caption | Form fields | — |
| **Deductions** | Icon mark + "Deductions" + subtitle, filter icon | Total estimated deductions | By category | Recent receipts → full list |
| **Benefits** | (BenefitsFeature — separate module) | — | — | — |
| **Ask Glovebox** | Modal header + close | — | Message thread | — |
| **Settings** | "Settings" | — | Profile / Vehicle / Deductions / AI memory cards | — |

Full-screen flows (Scan Receipt, Log Trip, Ask Glovebox) are `fixed inset-0` overlays, not new routes — they always have a `ChevronLeft`/`X` back control top-left and their own safe-area-aware header/footer.

---

## 10. Implementation Audit & Future Design Rules

This is what actually needs standardising — found by reading the real code, not invented.

### Inconsistencies found

1. **Two card systems, one named, one not.** The light-mode `Card` component (`export function Card`) is a real, reusable, documented component. The dark-mode card pattern — `#0D1B2E` bg, `rgba(255,255,255,0.08)` border, `rounded-2xl` — is used 27+ times but only ever as an inline `style={{...}}` object copy-pasted screen to screen. **Fix:** extract a `DarkCard` component mirroring `Card`'s API (`children`, `className`, `style`, `delay`) before the next dark screen is built, rather than copy-pasting the inline style a 28th time.
2. **Dark palette has no named tokens.** `#081425`, `#0D1B2E`, `#14233A`, `#AEB9CB`, `#79879C` are correct and consistent (see the frequency counts in §2) but exist only as string literals. **Fix:** promote them to exported constants alongside `NAVY`/`TEAL`/etc. — e.g. `DARK_BG`, `DARK_CARD`, `DARK_CARD_BORDER`, `DARK_SURFACE`, `DARK_TEXT`, `DARK_TEXT_MUTED` — so a future screen can't accidentally introduce `#0D1B2D` by typo.
3. **`AnimatedBar`'s default track colour is light-only.** Its `trackColor` prop defaults to `#EEF0F4`, which is invisible/wrong on a dark card unless every call site remembers to override it (one call site didn't, and shipped a visibly wrong white progress track before being caught and fixed). **Fix:** either flip the default based on a `dark` boolean prop (matching the `ReceiptForm`/`ReceiptRow` pattern already established elsewhere) or make `trackColor` a required prop so it can never be silently wrong.
4. **No formal input error/validation state.** Errors are currently ad-hoc `AMBER` helper text (distance lookup) with no red/destructive equivalent anywhere. Fine for now since nothing has needed hard validation yet, but the first form that does (e.g. a required field) shouldn't invent its own pattern — decide the red/error token now, before it's needed under time pressure.
5. **Accessibility is unverified, not un-implemented.** Tap targets and safe areas are handled well; VoiceOver labelling and Dynamic Type scaling have not been explicitly tested. Not a redesign issue, just an open item.

### Reusable component inventory (already exists — use these, don't rebuild them)
`Card`, `SectionTitle`, `Pill`, `Field` / `DarkField`, `inputCls` / `darkInputCls`, `EmptyState`, `RadialProgress`, `AnimatedBar`, `TrendSparkline`, `AnimatedNumber`, `Disclosure`, `ReceiptForm` (`dark` prop), `ReceiptRow` (`dark` prop), `FloatingActionButton`, `AssistantButton`, `ReadinessItem`.

### Design tokens recommended for extraction (from this audit)
```ts
// Dark surface — promote alongside the existing light exports
export const DARK_BG = "#081425";
export const DARK_CARD = "#0D1B2E";
export const DARK_CARD_BORDER = "rgba(255,255,255,0.08)";
export const DARK_SURFACE = "#14233A";       // elevated/interactive
export const DARK_TEXT_SECONDARY = "#AEB9CB";
export const DARK_TEXT_MUTED = "#79879C";
```

### Rules for everything built from here on
1. **Check this document before inventing a value.** A new hex, a new spacing number, a new radius — if it's not in §2–§4, it's wrong until it's added here deliberately, not accidentally.
2. **New dark screens use the (soon-to-exist) `DarkCard` + dark tokens above — never a fresh inline hex.**
3. **One question per screen, always** (§1). If a screen review can't produce a one-sentence answer to "what question does this screen answer," the screen needs to be split or trimmed before it ships.
4. **Every new colour pairing gets a contrast check** before shipping, the same way `GREEN`/`GREEN_DARK` did.
5. **Motion budget:** entrance ≤500ms, fills/counters ≤700ms, everything else instant. If an animation needs to be longer than that to look right, the animation is wrong, not the budget.
6. **Copy gets read out loud before it ships** (§8's test). If it sounds like a form, rewrite it.
7. **This document gets updated in the same PR/commit that introduces the pattern it documents** — not as a follow-up "someday." A design system that's a version behind the code isn't a source of truth.
