# Brandbook & design system

## Brand voice

Git Manager is a focused desktop tool: calm, precise, and dense. Copy is short and operational — no marketing fluff in chrome. The product name is the primary brand signal on empty states; elsewhere the UI stays quiet so history and diffs lead.

**Do:** clear verbs (Open, Commit, Fetch), mute secondary metadata, use ember only for primary action and focus.

**Don't:** blue-gray “generic git client” chrome, neon glow stacks, purple marketing gradients, or card dashboards in the shell.

## Visual direction — Ink & Ember

Warm charcoal ink surfaces, an ember signal accent, cool stone light mode. Dense like a serious git client; identity that is not Fork / GitKraken / SourceTree blue-accent.

## Color palette

Resolved via CSS variables on `[data-theme="dark"]` and `[data-theme="light"]` in [`src/renderer/src/styles/global.css`](../src/renderer/src/styles/global.css).

### Core (dark)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#12110F` | App canvas |
| `--bg-elevated` | `#1C1A17` | Toolbar, menus, elevated chrome |
| `--bg-panel` | `#161411` | Sidebars, panes |
| `--bg-subtle` | `#221F1B` | Nested / rebasing / warning strips |
| `--border` | `#2E2A24` | Hairlines |
| `--border-strong` | `#3F3931` | Stronger dividers |
| `--text` | `#F2EDE6` | Primary text |
| `--text-muted` | `#9A9186` | Secondary text |
| `--text-inverse` | `#12110F` | Text on accent fills |
| `--accent` | `#E85D04` | Primary actions, selection rim |
| `--accent-hover` | `#F48C06` | Primary hover |
| `--accent-muted` | `rgba(232, 93, 4, 0.16)` | Soft accent wash |
| `--success` | `#6A9B6E` | Success / ahead-clean |
| `--danger` | `#E35D5D` | Destructive / errors |
| `--warning` | `#D4A017` | Caution / rebase |
| `--info` | `#5B8FA8` | Informational |
| `--row-hover` | `#24201C` | List hover |
| `--row-selected` | `rgba(232, 93, 4, 0.18)` | Selection |
| `--focus-ring` | `#E85D04` | `:focus-visible` |
| `--sha` | `#E8A87C` | Monospace SHAs |
| `--banner-danger-bg` | `#3A1E1E` | Error banner |
| `--banner-danger-fg` | `#F5C4C4` | Error banner text |
| `--banner-danger-border` | `#6B3030` | Error banner border |

### Core (light)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#F4F6F8` | App canvas |
| `--bg-elevated` | `#FFFFFF` | Elevated chrome |
| `--bg-panel` | `#EEF1F4` | Panels |
| `--bg-subtle` | `#E6E9ED` | Nested strips |
| `--border` | `#D5DBE3` | Hairlines |
| `--border-strong` | `#B8C0CC` | Stronger dividers |
| `--text` | `#1A1D21` | Primary text |
| `--text-muted` | `#5C6672` | Secondary text |
| `--text-inverse` | `#FFFFFF` | Text on accent fills |
| `--accent` | `#E85D04` | Same ember accent |
| `--accent-hover` | `#D45203` | Primary hover (light) |
| `--row-selected` | `rgba(232, 93, 4, 0.14)` | Selection |

### Graph lanes

`--lane-1` … `--lane-8`: ember, sage, amber, coral, plum, teal, rose, olive — used by the history graph and ref decoration.

## Typography

Bundled **IBM Plex Sans** + **IBM Plex Mono** via `@fontsource`.

| Role | Token / class | Size / weight |
|---|---|---|
| Body | `--text-sm` (root 13px) | Regular / medium |
| Micro label | `--text-xs` / `.panel-title` | 11px, uppercase, tracked |
| Meta | `--text-sm` muted | 12px |
| Title | `--text-lg` | 15px semibold |
| Welcome brand | `--text-2xl` | 28px semibold |
| SHA / code | `--font-mono` / `.sha` | Plex Mono |

## Spacing & tokens

| Scale | Values |
|---|---|
| Space | `--space-1` 4px … `--space-6` 24px |
| Radius | `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 10px |
| Motion | `--duration-fast` 120ms, `--duration-normal` 180ms, `--ease-out` |
| Elevation | `--shadow-menu`, `--shadow-modal` |

Layout prefs remain: `--sidebar-width`, `--inspector-height`, `--detail-width`, etc.

## Icons

**lucide-react**, default **16px**, `strokeWidth` 1.75–2. Use for chrome (sidebar, branch, sync, theme, toolbar, changes, stash, inspector). History topology stays custom SVG.

### Pattern

- **Label + leading icon** for primary actions (`Button` with `icon`).
- **Icon-only** (`IconButton`) for dense chrome: sidebar toggle, new branch, branch Merge/Rebase/Del, inspector dock.
- **Focus/hover hints:** every icon control sets `data-hint` (and `title` / `aria-label`). CSS `.has-hint` shows a tooltip on `:hover` and `:focus-visible` so keyboard users get the same affordance as pointer users. Use `.has-hint-above` when the control sits at the bottom edge of a clipped region (e.g. toolbar tabs). Use `.has-hint-leading` (or row-action scoped rules) when the control sits in an `overflow: auto` list so the hint does not force a scrollbar.

### Chrome inventory

| Surface | Controls |
|---|---|
| Toolbar | History, Changes, Resolve conflicts, Search, Sync (+ Fetch/Pull/Push), theme |
| Welcome | Add local, Clone, Connect accounts |
| History | Jump to HEAD |
| Changes | Stage / Unstage / Discard, Commit/Amend, Stash Apply/Pop/Drop, rebase Continue/Abort |
| Inspector | Copy SHA, Merge, Rebase, dock position |
| Sidebar | Collapse, New branch, branch Merge/Rebase/Delete |

## Theme

`AppPreferences.theme`: `system` | `light` | `dark`. Resolved to `document.documentElement.dataset.theme` and Electron `BrowserWindow` background. Monaco uses `vs` / `vs-dark`.

## Components

Primitives in [`src/renderer/src/components/ui/`](../src/renderer/src/components/ui/):

| Component | Use |
|---|---|
| `Button` / `IconButton` | Primary, ghost, danger actions |
| `Input` / `Select` / `Field` | Forms |
| `Modal` | Backdrop + chrome |
| `Banner` | Error / warning / info |
| `Badge` / `RefPill` | Status and refs |
| `SegmentedControl` | History/Changes, theme |

## Motion

Hover/focus: 120ms. Modal/panel opacity: 180ms ease-out. No bounce, no persistent glow.

## App mark

Packaging and window icon: charcoal rounded square (`#12110F`) with an ember (`#E85D04`) commit-node + graph lanes.

| Asset | Path |
|---|---|
| Source SVG | [`build/icon.svg`](../build/icon.svg) |
| PNG 1024 | [`build/icon.png`](../build/icon.png) |
| Windows ICO | [`build/icon.ico`](../build/icon.ico) |
| macOS ICNS | [`build/icon.icns`](../build/icon.icns) |
| Favicon SVG | [`src/renderer/favicon.svg`](../src/renderer/favicon.svg) |
| Favicon ICO | [`src/renderer/favicon.ico`](../src/renderer/favicon.ico) |

Regenerate all derived assets after editing the SVG:

```bash
npm run icons
```
