# Sanguine — aesthetic brief

**One line:** pallor and blood. A near-black oxblood crypt, bone-pale chrome,
arterial crimson in the details, and a serif display face — rendered as a
Deus Ex–style instrument panel, not a goth poster.

This is the design philosophy for the page, the games, the UI, the themes and
the page icon. It is not a suggestion set; it is the house style.

## Palette

| Role | Value | Notes |
| --- | --- | --- |
| Surfaces (4 tiers) | `#0b0609` → `#12080c` → `#1a0d12` → `#241119` | near-black with a dried-blood cast, never neutral grey |
| Text (5 tiers) | `#f2e6e6` · `#c3a9ad` · `#8f6f76` · `#5c434a` · `#0b0609` | bone down to dried blood |
| Primary accent | `#e9d8c5` (bone/pallor) | buttons, focus rings, selection — 14.45:1 on base |
| Secondary accent | `#b81d3a` (arterial blood) | decorative only: gradients, logo, bloom |
| Brand ink / identity | `#d9557a` | the mark, splash, version chip run pink |
| Link | `#ff8fa3` | |
| Borders | `#150a0e` · `#2a141c` · `#3d1f28` | |
| Error | `#ff5470` | |
| Warning | `#d9a441` | candlelight |
| Success | `#5fa777` | verdigris |
| Info | `#7e9cc4` | cold moonlight |
| Pending | `#a884c9` | |
| Categorical | `#6fb3ab` · `#8a8fc9` · `#a884c9` · `#c96a8e` | muted, gaslit |
| Gradients | `135deg #e9d8c5 → #b81d3a` · `90deg #b81d3a → #a884c9` | |

### The key design decision, and why it matters

The obvious move is a blood-red primary accent. **Don't.** Crimson sits ~2° of
hue from the error rose and only 1.46:1 apart in value, so a primary button and
an error badge become the same object. A vampire is pallor first, blood second —
so the accent is bone (near-neutral, never competes with a status colour), and
blood lives in the secondary, the glow, and the surfaces underneath. Every
status pair is ≥49° apart in hue.

## Light, glow, and material

- Bloom is **blood, not bone** — a crimson halo around pale chrome is the whole
  idea: `0 0 12px rgba(216,58,88,.45), 0 0 26px rgba(216,58,88,.16)`, scaling up
  to `0 0 22px` / `0 0 52px` for large elements, plus an
  `inset 0 0 60px rgba(184,29,58,.05)` on large surfaces so panels feel lit from
  within.
- Hairlines and hover washes are **bone at 4–8% over oxblood** — the red comes
  from the surface beneath, which keeps the washes from turning muddy.
- Shadows are true black, modal scrims `#050203`.
- Overlay ramp: hover 6%, active 12%, selected 10%, status fills 14%, strong 16%.

## Colour in a lit 3D scene

The palette above is specified for flat UI, where a value *is* the pixel. In a
renderer every colour goes through albedo × light × tonemap first, and three of
these values break on the way. Each of the following was hit in practice
building `arcade/games/ossuary/`; none is a reason to loosen the palette, they
are conversions to apply when a value becomes a material or a light.

**Surface tiers are unusable as albedo.** `#241119` and `#1a0d12` are already
near-black as pixels; as albedo, multiplied by any plausible light, they render
as pure black and the geometry disappears — the first lit floor was invisible.
Keep the hue, raise the value: around `#4a3138` for lit stone and `#38242a` for
walls read as the same oxblood once the lighting is applied. The near-black
register is then produced by the *lighting* being scarce, which is what the
brief actually asks for, rather than by the surfaces being unlit black.

**Arterial crimson makes a purple light.** `#b81d3a` linearises to roughly
`(0.48, 0.012, 0.042)` — more blue than green — so every surface it lights
picks up a violet cast and the whole scene turns lilac. As a *light source* use
a warm ember, `(0.52, 0.10, 0.032)` linear, which still reads as blood on the
wall while bouncing warm. Crimson stays correct as an emissive surface and as a
bloom colour; it is only wrong as the colour of the light itself.

**Emissive crimson clips to pink.** Push a crimson emitter bright enough and
the red channel saturates through the tonemap while green and blue are lifted
by the gamma encode — the result is hot pink, the exact collision the palette
was designed to avoid, arriving from the render pipeline rather than from the
picker. Hold emissive crimson under the clip (with ACES and exposure ~1.1, that
is roughly `albedo × 1.6` at most) and lower the bloom threshold to compensate
if it needs to glow. Bright and *saturated* are separate controls; reach for
bloom, not intensity.

The general rule: **a value's brightness and its role in the lighting are
separate knobs.** Conflating them is what produced all three bugs — an object
was made brighter to make it self-lit, or dimmer to stop it blowing out. Carry
an explicit material flag instead.

## Typography

Display face is a serif — `Georgia, "Times New Roman", serif` — against a normal
UI sans for body and data. That single choice does more for the gothic read than
any colour here. Keep body text sans and tabular where it's numeric; the serif
is for headers, the wordmark, and section titles only.

## Iconography — no emoji, ever

This is non-negotiable to the look. Use real vector icon sets — thin-to-medium
stroke line icons (Lucide, Phosphor, Tabler, Remix) at consistent stroke width,
or custom SVG glyphs. Emoji break the aesthetic instantly: they carry their own
colour palette, their own rendering, and a cartoon register that fights
everything above. Where you'd reach for an emoji, draw a glyph.

Where an ornament is needed, use typographic marks, not pictures —
❦ ✦ ◆ ◈ ❖ ▸ ‡ §. The theme's own picker label is **❦ Sanguine**.

## Deus Ex / futuristic-instrument layer

Treat every panel as hardware readout, not a web card:

- Sharp or barely-rounded corners (0–4px), hairline borders, hard rectilinear
  grids. No pill-soft "friendly SaaS" geometry.
- Corner brackets, tick marks, rules, and thin divider lines that suggest a
  machined bezel.
- Data displayed as **instruments**: bar meters, segmented gauges, small-caps or
  uppercase micro-labels with wide letter-spacing, monospace tabular numerals,
  live-looking counters.
- Status conveyed by a small solid indicator dot with a bloom halo, not by a
  coloured emoji or a big pill.
- Motion is mechanical and short — 120–200ms, precise easing, sweep/scan rather
  than bounce. A slow 60s rotation on the emblem, nothing playful.
- Gold-and-black is the *other* Deus Ex read; here that register is
  **bone-and-oxblood** — same discipline, funereal palette.

## The register to hold

Gothic, funereal, candlelit, clinical. Restrained rather than theatrical: it
should read as an operator's console in a crypt, not as Halloween. Colour is
scarce and meaningful — most of the screen is near-black and bone, and every
saturated pixel is either a status signal or a deliberate arterial accent.

---

## Appendix: tokens

Derived mechanically from the values above — no new decisions. Use these names
so every surface stays in step.

```css
:root {
  /* surfaces */
  --s-0: #0b0609;  --s-1: #12080c;  --s-2: #1a0d12;  --s-3: #241119;

  /* text */
  --t-0: #f2e6e6;  --t-1: #c3a9ad;  --t-2: #8f6f76;  --t-3: #5c434a;
  --t-inv: #0b0609;

  /* accents + identity */
  --accent: #e9d8c5;         /* bone — primary, never a status colour */
  --accent-2: #b81d3a;       /* arterial — decorative only */
  --brand: #d9557a;
  --link: #ff8fa3;

  /* borders */
  --line-0: #150a0e;  --line-1: #2a141c;  --line-2: #3d1f28;

  /* status */
  --error: #ff5470;  --warning: #d9a441;  --success: #5fa777;
  --info: #7e9cc4;   --pending: #a884c9;

  /* categorical */
  --cat-1: #6fb3ab; --cat-2: #8a8fc9; --cat-3: #a884c9; --cat-4: #c96a8e;

  /* gradients */
  --grad-1: linear-gradient(135deg, #e9d8c5, #b81d3a);
  --grad-2: linear-gradient(90deg, #b81d3a, #a884c9);

  /* bloom */
  --bloom:    0 0 12px rgba(216,58,88,.45), 0 0 26px rgba(216,58,88,.16);
  --bloom-lg: 0 0 22px rgba(216,58,88,.45), 0 0 52px rgba(216,58,88,.16);
  --lit-within: inset 0 0 60px rgba(184,29,58,.05);
  --scrim: #050203;

  /* overlay ramp (bone over oxblood) */
  --ov-hover: rgba(233,216,197,.06);
  --ov-active: rgba(233,216,197,.12);
  --ov-selected: rgba(233,216,197,.10);
  --ov-status: rgba(233,216,197,.14);
  --ov-strong: rgba(233,216,197,.16);

  /* type */
  --font-display: Georgia, "Times New Roman", serif;
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  /* geometry + motion */
  --radius: 2px;              /* 0–4px only */
  --dur: 160ms;               /* 120–200ms */
  --ease: cubic-bezier(.2,.6,.2,1);
}
```
