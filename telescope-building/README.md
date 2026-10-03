# BUILDING — telescope zoom page

Single page based on the Codrops "Telescope Zoom" demo (MIT): layered zoom on scroll with GSAP ScrollSmoother + ScrollTrigger.

Open `index.html` through any static server (e.g. `python3 -m http.server`), not via `file://`.

- `img/` — 10 small photos (alternating colour / black-and-white), `img-big.webp` for the zoom, `mask.png` from the template
- `vendor/` — GSAP 3.13 (gsap, ScrollTrigger, ScrollSmoother)
- `fonts/` — Bebas Neue (SIL OFL)

The page has a LIGHT / DARK switch in the top-right corner (light `#F3EFE8` + `#AD0003`, dark `#0B1621` + `#E8EEF2`). The choice is stored in `localStorage`.
