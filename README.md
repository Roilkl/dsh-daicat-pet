# Daicat Desktop Pet · dsh-daicat-pet

[![npm version](https://img.shields.io/npm/v/dsh-daicat-pet.svg)](https://www.npmjs.com/package/dsh-daicat-pet)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [中文](README.zh.md)

A cat companion for the DeepSeek Harness chat UI. It follows the session state and switches poses, says an editable line when you click it, and reports the **token usage** of each finished turn. It can be dragged (with a squish), flipped, and resized — without taking up a separate window.

▶ **[Watch the demo video](media/demo.mp4)** (1.6 MB, screen recording)

> **Artwork notice:** the spritesheet is derived from third-party GIFs. The publisher states public redistribution permission was obtained, but the permission text is not included in this repository — verify the exact scope with the original author before reusing or redistributing the artwork. The MIT license **does not cover the artwork**.

## Features

| Action / timing | Effect |
| --- | --- |
| Click the cat | Shows the next line from `lines.json`, cycling through the list |
| Drag | Follows the pointer, squishes slightly on press and springs back on release; the position is remembered in the browser |
| Move to the left half of the page | The cat flips horizontally; it flips back on the right half |
| `Ctrl` + mouse wheel | Resizes between 48 and 640 px wide; the size is remembered in the browser |
| End of each turn | Shows the turn's total tokens plus input, output, cache read and cache write, and plays the finished pose |
| Session state changes | Switches between idle, running, waiting for input, failed and ready-to-review poses |

> These are **token counts, not money**. If the host exposes no `tokenUsage` projection, every other feature still works and only the per-turn bubble is skipped.

## Install

### DSH Web

From npm — the package is published as [`dsh-daicat-pet`](https://www.npmjs.com/package/dsh-daicat-pet):

```powershell
dsh plugin --profile web add dsh-daicat-pet
```

From this repository (the same release, if you prefer to pin the git source):

```powershell
dsh plugin --profile web add github:Roilkl/dsh-daicat-pet
```

Or from a complete local copy of the source (`package.json`, `lib/`, `assets/` and `cordis.patch.yml` present):

```powershell
dsh plugin --profile web add link:C:\path\to\dsh-daicat-pet
```

Restart `dsh web` afterwards, then reload the page. Use only one of these methods — do not mix them for the same package name.

### Official desktop client

The desktop app uses the `desktop` profile, **not** the `web` profile above, and `dsh plugin --profile desktop` is rejected by the CLI. Install the same npm package, GitHub repository or a complete local package into the current profile through the app's own plugin manager. If nothing appears after the first install, quit the client completely (including the tray) and reopen it. Do not copy or delete desktop-profile dependencies by hand.

Requirements: Node.js `>=22.19.0`, DSH `>=0.2.0-rc.1 <0.3.0-0`. The pet is drawn into the `shell.overlay` slot.

## Customize lines and looks

The default lines live in [`assets/daicat/lines.json`](assets/daicat/lines.json), a UTF-8 JSON array of strings:

```json
[
  "Writing code again?",
  "That turn is done — look at me"
]
```

Reload the page after saving and the new lines are picked up — **no host restart needed**. When a separate pet directory is used, edit that directory's `lines.json` instead; if the file is missing or malformed, the client falls back to built-in lines. Short sentences fit the small bubble better.

The default atlas and frame table are [`assets/daicat/spritesheet.webp`](assets/daicat/spritesheet.webp) and [`assets/daicat/anim.json`](assets/daicat/anim.json). To use your own character, override `petDir` by `id` in the profile's `cordis.patch.yml` rather than editing the installed package:

```yaml
- id: daicat-pet
  name: dsh-daicat-pet
  config:
    petId: daicat
    size: 192
    petDir: C:/path/to/my-pet
```

`petDir` must contain `anim.json` and `spritesheet.webp`; `lines.json` is optional. Resolution order: explicit `petDir` → bundled `assets/daicat` → `$DSH_HOME/desktop-pet/pets/daicat` (where `$DSH_HOME` defaults to `.dsh` in your home directory). Editing the profile config or host code needs a restart; changing only the frame table, atlas or lines needs a page reload. When overriding `config` at the profile layer, repeat `petId` and `size` so the defaults are not lost.

### Atlas format

The spritesheet has a transparent background and one state per row; a cell is **192 × 208** px. The bundled atlas is **66 columns × 9 rows (12672 × 1872)**, but the plugin reads rows, columns and per-state frame counts from `anim.json` — it does not require PetDex's fixed 8 columns.

```json
{
  "cell": { "w": 192, "h": 208 },
  "sheet": { "w": 1536, "h": 208, "cols": 8, "rows": 1 },
  "rows": [
    { "state": "idle", "frames": 6, "durations": [30, 30, 30, 30, 30, 30] }
  ]
}
```

`rows` order is the atlas row order; `frames` is how many columns the state actually uses; `durations` are the per-frame durations in milliseconds. If `durations` is longer than `frames`, the played column is the frame index modulo `frames` — so repeating a run of durations loops the animation. Built-in state names: `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`. The snippet above is a **format illustration**, not the full frame table of the bundled atlas.

## Project structure

```text
dsh-daicat-pet/
├── package.json              # package info and DSH bundle/client declarations
├── cordis.patch.yml          # host plugin mount config
├── icon.svg                  # plugin icon
├── lib/
│   ├── index.js              # host: asset routes, per-turn token accounting
│   └── client.js             # page: drawing, animation, interaction, bubbles
├── assets/daicat/
│   ├── anim.json              # states and frame durations
│   ├── spritesheet.webp      # third-party atlas (not covered by the MIT license)
│   └── lines.json             # click lines
├── media/demo.mp4            # demo recording
├── locale/                   # Chinese and English descriptions
├── README.md
├── README.zh.md
└── LICENSE                   # code only, does not cover the third-party artwork
```

## Troubleshooting

- **Nothing appears after install**: make sure the package went into the profile you are actually running, restart the host, then reload the UI. The desktop client cannot be installed for with the `--profile web` command.
- **The cat shows but does not animate**: check the atlas dimensions and that `anim.json` row order and frame counts match the sheet. Do not simply rename a GIF to WebP.
- **No lines**: check that `lines.json` is a valid JSON array of strings, then reload the page.
- **No per-turn usage**: the turn must actually finish, and DSH's `sessionProjections` / `tokenUsage` service must provide data. This plugin never reads API balance and never computes money.
- **Debug endpoints**: local only — `/dsh-daicat-pet/anim.json`, `/atlas.webp`, `/api/lines`, `/api/turn`, `/api/state`; `/api/pose?set=waiting&ms=1000` forces a pose temporarily. `/api/state` returns local absolute paths, so do not paste an unsanitized response in public.

## Credits and license

The cat animation artwork comes from the "呆猫表情包合集" (daicat sticker collection) made by the Xiaoheihe user **「van家11451419」**. The interaction design and the per-turn bubble are inspired by [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget); the pet atlas and state organisation also reference **dsh-desktop-pet**. This plugin only shows token counts and does not port the whale's balance, pricing or settings panel. Thanks to all of them.

The **code** is licensed under the [MIT License](LICENSE). The daicat atlas and the original GIFs are third-party artwork and are **not** covered by MIT; the publisher states public redistribution permission was obtained, but no verifiable permission text is provided in this repository. Attribution does not grant downstream rights to modify or redistribute the artwork — verify the actual scope with the original author.
