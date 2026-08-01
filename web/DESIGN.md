# DataPulse AI Design System

## 1. Atmosphere & Identity

DataPulse is a dark, premium research cockpit: blueprint-ink surfaces, fine technical hairlines, and restrained violet/cyan signal light make streamed agent work legible without competing with it. The recognizable signature is the aurora-and-grid shell behind layered ink panels; violet carries primary activity and cyan is a secondary live-data highlight.

## 2. Color

### Palette

| Role | Token | Current value | Usage |
|---|---|---:|---|
| Primary page surface | `ink-900` | `#0b0f1a` | Application background |
| Deep surface | `ink-950` | `#05070d` | Logo contrast and deepest accents |
| Panel surface | `ink-850` | `#0d1424` | Glass panels and cards |
| Raised control surface | `ink-800` / `ink-750` | `#111a2e` / `#16213a` | Inputs, code, compact controls |
| Structural edge | `edge` / `edge-strong` | `#1c2740` / `#2c3d63` | Hairlines, focused control boundary |
| Primary text | `frost-50` | `#f4f7ff` | Headings and active text |
| Secondary text | `frost-200` / `frost-400` / `frost-500` | `#dbe3f2` / `#aab6d2` / `#8493b3` | Body, metadata, disabled content |
| Primary activity | `pulse-300` through `pulse-600` | `#c4b5fd` → `#7c3aed` | Primary actions, focus, live work |
| Live-data accent | `glow-300` through `glow-500` | `#67e8f9` → `#06b6d4` | Secondary signal and gradient endpoint |
| Success | `mint-400` | `#34d399` | Completed connection or run |
| Warning | `amber-400` | `#fbbf24` | Cautionary progress state |
| Error | `coral-400` | `#fb7185` | Errors and destructive status |

Only these existing `@theme` tokens are used by product UI. Gradients use the existing pulse-to-glow range; raw color values stay in `app/globals.css` or this record.

## 3. Typography

The primary stack is Geist through `--font-sans`, followed by system UI and Korean fallbacks (`Apple SD Gothic Neo`, `Noto Sans KR`). `--font-mono` is Geist Mono followed by SF Mono/Menlo and is reserved for agent metadata, IDs, event names, and raw JSON.

| Level | Existing scale | Usage |
|---|---:|---|
| Product title | 17px, semibold, tight tracking | Header brand |
| Panel title | 13–17px, semibold | Cockpit and timeline headings |
| Body | 13–14px, relaxed | Questions, tool detail, event content |
| Metadata | 11–12px, medium or mono | Status pills, labels, timestamps |
| Raw payload | 11–12px mono | JSON disclosure |

Korean text remains in the sans stack and body text stays at least 13px in this compact operational UI. Long technical values use wrapping rather than truncating information silently.

## 4. Spacing & Layout

The system uses a 4px rhythm: `1` 4px, `2` 8px, `3` 12px, `4` 16px, `5` 20px, `6` 24px, `8` 32px, `10` 40px, `12` 48px. Existing page gutters are 16px mobile and 24px from `sm`; panel padding is predominantly 16px/24px; major content gaps are 20px.

The main shell is capped at 1180px and becomes a one-column layout below `lg`. Document pages own normal document scroll. A bounded live-work region may use the existing `min-h-0 flex-1 overflow-y-auto` pattern: the event/message pane owns its own vertical scroll while its input and shell remain visible. Every flex/grid child that can scroll has `min-h-0`; unbroken external content uses `min-w-0` and `overflow-wrap:anywhere`.

## 5. Components

### Ink Panel

- **Structure**: rounded panel, `border-edge`, translucent `ink-850`, `shadow-card`, optional backdrop blur.
- **Spacing**: 16px compact or 24px standard internal padding; 20px between panels.
- **States**: rest, loading, empty, error, and focused descendant.
- **Accessibility**: semantic heading where titled; content must remain readable at 200% zoom.
- **Layout**: stack; a timeline panel can be a scroll-body owner.

### Status Pill

- **Structure**: small dot plus concise label in a bordered full pill.
- **Variants**: idle/frost, connecting/pulse, connected/mint, error/coral.
- **States**: static meaning first; pulse animation is secondary and disabled for reduced motion.
- **Accessibility**: status text never relies on dot color alone; live updates are announced from a labelled status region.

### Composer

- **Structure**: label, textarea/input, helper or inline error, primary send/cancel action.
- **States**: default, focus-within, disabled while streaming, validation error, sending.
- **Accessibility**: visible label, Enter sends and Shift+Enter adds a line, focus stays in the composer after validation errors.
- **Layout**: cluster that wraps safely at narrow widths.

### Event Timeline Row

- **Structure**: ordered event marker, type/status label, payload summary, optional raw JSON disclosure.
- **Variants**: raw event, function call, function output paired by `callId`, terminal completion, error, malformed source line.
- **States**: incoming/live, completed, error, empty.
- **Accessibility**: uses list semantics and native `details/summary` for raw payload; unbroken JSON and command values wrap anywhere.
- **Layout**: stack inside a scroll-body panel; event rows do not create horizontal page scroll.

## 6. Motion & Interaction

Existing motion uses 300–400ms entry fades/slides with `cubic-bezier(0.16, 1, 0.3, 1)`, a 2.2s soft pulse for active status, and 1.1–2.6s progress treatments. Motion is informational only: connecting status and an in-flight work marker may animate; terminal/error states do not pretend work is continuing. New interaction feedback uses existing color transitions and active-state opacity, not new motion tokens. `prefers-reduced-motion: reduce` removes nonessential timeline/status animation and uses immediate state changes.

## 7. Depth & Surface

The existing strategy is mixed: tonal ink steps establish hierarchy, `edge` hairlines define dense boundaries, and `shadow-card` adds a subtle inset highlight plus a heavily diffused dark lift. Aurora/grid/noise are page-shell atmosphere only and never obscure text or controls. Rounded panels are 12–16px; pills are fully rounded; compact controls are 8–12px.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA: at least 4.5:1 for body text and 3:1 for large text/essential boundaries.
- Keyboard focus is visible through the existing pulse focus treatment; every action has a text label or accessible name.
- Status changes use text and color; stream updates use a polite live region without moving focus.
- Inputs retain user text exactly as data; no received tool/event payload is rendered as HTML.
- `prefers-reduced-motion` disables nonessential status/timeline movement.
- CJK content, URLs, JSON, and external commands must wrap safely; primary content has no horizontal scrolling at 375px.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Existing page has a few 12–12.5px compact captions | Current shared components | Preserved extraction scope; legible but below the preferred compact-body scale | Main-screen consolidation commit |
| Existing global motion lacks one centralized reduced-motion override | `app/globals.css` | This slice scopes reduced-motion locally and does not redesign existing components | Design-system hardening commit |
| Existing raw CSS token values predate this document | `app/globals.css` | This file records them without token migration | Token refactor only when main screen is adapted |
