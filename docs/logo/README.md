# Palimpsest logo and icons (dark)

The mark is a letter P built from the app's own parts: three author tracks make the stem and the two bars, and the yellow-green playhead closes the curve. It is drawn on the dark tile color `#201c26` using the dark theme's first three author colors and the "now" color.

Only the dark version exists so far. The favicon is the same in both app themes: it carries its own dark tile, so it reads on light and dark browser tab bars, and it does not change with the app's sun and moon switch.

## Files

| File | Size | Use |
| --- | --- | --- |
| `favicon.svg` | vector | Favicon for modern browsers |
| `favicon.ico` | 16, 32, 48 | Favicon fallback for older browsers |
| `favicon-16.png`, `favicon-32.png` | 16, 32 | PNG favicons, if needed |
| `apple-touch-icon.png` | 180 | iOS home screen. Square with no rounded corners and no transparency, because iOS rounds the corners itself |
| `icon-192.png`, `icon-512.png` | 192, 512 | Web app manifest, `"purpose": "any"` |
| `icon-512-maskable.png` | 512 | Web app manifest, `"purpose": "maskable"`. The mark is scaled down to sit inside the safe zone that Android crops to a circle or squircle |
| `logo-mark.svg` | vector | The mark alone, for the README or social images |
| `logo-lockup-dark.svg`, `logo-lockup-dark@2x.png` | vector, 523 × 128 | Mark and wordmark together, for dark backgrounds |
| `wordmark-dark.svg` | vector | PALIMPSEST alone, for dark backgrounds |

The wordmark is Barlow Condensed 600, uppercase, letter spacing 0.02em, converted to outlines so it needs no font. In the app header, keep using live text in Barlow Condensed, as in the designs.

## Mark geometry

On a 64 × 64 grid, before centering (the files center it on the tile):

| Part | Rectangle | Radius | Color |
| --- | --- | --- | --- |
| Tile | 0, 0, 64 × 64 | 14 | `#201c26` |
| Stem | 13, 13, 10 × 41 | 3 | `#6dabdf` (author 1) |
| Top bar | 25, 13, 18 × 10 | 3 | `#9df3cc` (author 2) |
| Middle bar | 25, 32, 18 × 10 | 3 | `#dfc1ff` (author 3) |
| Playhead line | 45, 11, 5 × 31 | 1.5 | `#e4f26b` (now) |
| Playhead handle | 41.5, 7, 12 × 8 | 2.5 | `#e4f26b` (now) |

## In the HTML head

Copy the files into `web/public/` and add:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#201c26">
```

## site.webmanifest

```json
{
  "name": "Palimpsest",
  "short_name": "Palimpsest",
  "description": "Scrub through a git repository's history like a video.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#201c26",
  "theme_color": "#201c26",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Still to do

- A light version of the lockup and wordmark, for light backgrounds.
- Optionally, a social preview image (1200 × 630) for links shared on GitHub and social sites.
