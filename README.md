# Global Sentiment Flow-Mapper

An interactive 3D atlas of how the world's news media talks about itself.

The project takes 28,607 news flow records from the GDELT 2.0 Global Knowledge Graph (every record describes how one country's media covered another country on one date in one thematic domain) and renders them as an explorable 3D visualization. The same underlying data can be viewed three different ways: by geography, by mutual tonal affinity, or by directed sentiment toward a chosen focal country. A Compare overlay lets you study pairwise relationships from any reference.

It runs entirely in the browser, with no backend, no build step, and no framework. Three.js handles WebGL rendering. Everything else is vanilla JavaScript ES modules.

[View the project](https://indexohmany.github.io/Global-Sentiment-Flow-Mapper/)
## Table of contents

1. [What this project does](#what-this-project-does)
2. [The three viewing modes](#the-three-viewing-modes)
3. [Compare mode](#compare-mode)
4. [Filters and interaction](#filters-and-interaction)
5. [The data](#the-data)
6. [Quick start](#quick-start)
7. [Project structure](#project-structure)
8. [Key concepts](#key-concepts)
9. [Methodology and limitations](#methodology-and-limitations)
10. [Tech stack](#tech-stack)
11. [Browser support](#browser-support)
12. [Known limitations and roadmap](#known-limitations-and-roadmap)
13. [Acknowledgements](#acknowledgements)

## What this project does

Cross-country media sentiment is a signal that journalists, policy researchers, and diplomats spend significant effort tracking. GDELT publishes the raw material, but the raw material is rows of `(reporter, mentioned, domain, date, count, tone)` tuples that are useful in principle and unreadable in practice. The Sentiment Flow-Mapper bridges that gap by making three things visible at a glance:

* **Which countries get covered the most**, and from where.
* **Which countries cover each other warmly or coldly**, along thematic axes (politics, science, sports).
* **How those relationships change over time** within the 21-day data window.

Each of these questions corresponds to a different spatial arrangement of the same dataset, which is why the project exposes three viewing modes rather than a single fixed view.

## The three viewing modes

### Mode I: Geographic

Countries appear at their real latitude and longitude on an equirectangular projection. The world is rendered as a single continuous heightfield mesh of roughly 28,000 vertices. Each vertex's elevation is the sum of contributions from all reporting countries within its region of influence. A country's influence radius scales with its land area (about 4 degrees for Israel, up to 16 degrees for Russia), so reporting from large countries shapes a broader landscape than reporting from small ones. Vertex color comes from a 7-stop diverging palette (ember-red for negative tone, neutral slate at zero, moss and teal for positive). Negative-tone regions also receive a small randomized height jitter that gives them a rough, broken silhouette; positive-tone regions stay smooth. This is redundant encoding: tone reads correctly even at low camera tilt and for viewers with color-vision deficiencies.

Use this mode to answer: where is the news coming from, and what is its average emotional valence?

### Mode II: Reorganized (mutual affinity)

A force-directed simulation re-lays the same countries by mutual tonal affinity. For each unordered pair `{A, B}` the system computes a symmetric affinity score by weighted-averaging the directional sentiment in each direction, then runs 350 simulation iterations where positive scores attract and negative scores repel. Geography dissolves. What emerges are diplomatic and editorial neighborhoods: countries that report warmly on each other cluster together, countries that report coldly sit far apart.

Use this mode to answer: who are the natural allies and rivals in the media discourse?

### Mode III: UP/DOWN (focal-centric directed view)

Two stacked panes, each with a user-chosen focal country fixed at the center. Other countries arrange themselves radially around the focal by their directed `delta_tone` toward it. Countries that write positively about the focal cluster close; countries that write negatively fall to the outer ring. A 5-band distance schedule (strong positive, mild positive, neutral, mild negative, strong negative) maps the affinity gradient to concentric distance rings. An 80-pass repair loop after the simulation prevents polygon overlaps and keeps non-focal countries from crossing the pane divider.

Use this mode to answer: how does the world see country X, and how is that different from how the world sees country Y?

## Compare mode

Compare mode is an overlay available in Reorganized and UP/DOWN modes. When enabled, lines fan out from a reference country (manually selected in Reorganized; the focal countries themselves in UP/DOWN) to every other country. Each line is color-coded by the affinity score with the reference, and its brightness is weighted by a combination of signal strength and article volume, so that strong, high-confidence relationships pop and weak, low-volume relationships recede.

Hovering a line reveals a comparison tooltip with the country name, the reference name, the affinity score with sign and label (mutual or directed), a tier word (close, baseline, far, very far), and article counts in each direction. A floating midpoint label is anchored to the hovered line in world space and re-projected to the screen every frame, so the score feels attached to the relationship rather than to your cursor.

## Filters and interaction

Five filter axes live in a collapsible bar at the bottom of the screen. Filter changes are debounced and trigger a single re-aggregation pass; the result is then tweened into the heightfield over about 340 milliseconds:

* **Domain.** Politics, science, or sports. Mutually exclusive.
* **Time window.** A dual-thumb integer slider over the 21 available dates, with preset chips for common selections (all 21 days, last 7, election week, Olympics week, science week).
* **Reporters.** A two-pane selector. The "By Region" pane offers pill toggles for blocs (Western Europe, North America, etc). The "By Country" pane offers free-text search with autocomplete chips for individual countries. Selecting exactly two countries enables the UP/DOWN mode button.
* **Tone.** Three pills (negative, neutral, positive) for the `avg_tone` bucket. At least one must remain on.
* **Min articles.** A single-thumb slider that hides reporters publishing below a threshold.

Other interactions:

* **Camera orbit:** left-click drag.
* **Camera zoom:** mouse wheel.
* **Camera pan:** Ctrl/Cmd-drag, Shift-drag, or right-click drag. Pan speed scales with zoom distance.
* **Hover:** shows a tooltip with country stats.
* **Click a country:** opens a detailed modal with four KPIs, a tone distribution histogram, a daily volume timeline, top-mentioned-country bars, and a list of the 12 most extreme-tone articles with live URLs.
* **Mode toggle:** Geographic, Reorganized, UP/DOWN (UP/DOWN requires exactly two countries selected).
* **Elevation toggle:** flattens the heightfield without affecting the basemap.
* **Compare toggle:** activates the affinity overlay (Reorganized and UP/DOWN only).
* **Methodology link:** opens an in-app modal with data caveats and a detailed walkthrough of each mode.

## The data

The dataset comes from GDELT 2.0's Global Knowledge Graph, sampled every 4 hours (6 files per day) across three weeks chosen for thematic contrast:

* Late October 2025 (US election cycle)
* Late February 2026 (Milano-Cortina Winter Olympics)
* Mid-April 2026 (a science and technology news cycle)

After country attribution and theme filtering, the retained set is:

| Domain | Flow rows |
| --- | --- |
| Politics | 19,024 |
| Science | 9,432 |
| Sports | 151 |
| **Total** | **28,607** |

with 202 country-attributable reporters.

### Schema

The core unit is a flow row:

```
{date, reporter, mentioned, domain, count, avg_tone, delta_tone}
```

* `count`: number of articles by the reporter mentioning the target.
* `avg_tone`: mean tone across those articles, range roughly -8 to +8.
* `delta_tone`: `avg_tone` minus the global mean tone toward the same mentioned country on the same date in the same domain. This is the analytical correction that isolates reporter-specific bias from the inherent valence of the underlying events.

Article-level rows are kept separately for the top 100 most extreme-tone articles per reporter, surfaced in the country detail modal:

```
{date, url, source, tone, mentioned, domains}
```

Country records include a name, lat/lon, regional bloc, and one or more polygonal shapes for basemap rendering.

### On-disk layout

Data files are split across the `data/` directory.

## Quick start

The project is static. There is no backend, no database, and no build step. You need:

* A modern browser.
* A local HTTP server (the project loads JSON via `fetch`).

1. Clone the repository
2. Start any static HTTP server. The simplest option is Python's built-in server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

If you prefer Node:

```bash
npx http-server -p 8000
```
or 
```bash
npx serve
```

Or with PHP:

```bash
php -S localhost:8000
```

## Project structure

* `data.js` owns the top-level `await` for the data fetch. Other modules import the resolved values directly; ES modules automatically wait for the await of imported modules.
* `palette.js` tone color stops, `toneColor` (with an optional in-place out-parameter to avoid GC churn in hot loops), and the `toneTagOf` bucket classifier.
* `modal.js` contains the entire country detail modal, including three SVG chart renderers and the article list builder. It reads `filterState` through an `initCountryModal` call.
* `script.js` scene setup, basemap, heightfield, both layout simulations, filter UI and aggregation, Compare module, camera (orbit and pan), click handler, tweening, mode switching.

## Key concepts

### delta_tone

The single most important calculation in the project. GDELT's raw `avg_tone` conflates three things:

1. The sentiment of the language used.
2. The inherent valence of the topic (a hurricane scores negative even when reporting is sympathetic).
3. Source-level editorial bias.

If you visualize `avg_tone` directly, you mostly see (2). Countries covering disasters look identically negative regardless of their editorial stance. The `delta_tone` correction subtracts the global mean tone toward each mentioned country on each date in each domain, leaving only the difference between how this particular reporter covered the event and how the world on average covered it. Modes II and III and the Compare overlay all read off `delta_tone`, not raw tone, which is what makes those views meaningful.

### The heightfield

The 3D landscape in Mode I is not a stack of per-country extrusions. It is a single continuous mesh whose vertices contribute additively, so overlapping influence zones (Western Europe, the Middle East) form proper mountain ranges with ridges and valleys, rather than disconnected blocks. The math per vertex is:

```
contribution = log(C.count + 1) * SCALE * falloff(dist(V, C), C.radius)
```

summed across all reporting countries C in range, where `falloff` is a smooth cosine bump that peaks at the country centroid and drops to zero at its radius.

### Symmetric affinity (Mode II)

For each unordered pair of countries `{A, B}`, the symmetric affinity score is the article-count-weighted average of the two directional `delta_tone` values:

```
sym(A, B) = (delta_tone(A->B) * n_A + delta_tone(B->A) * n_B) / (n_A + n_B)
```

Pairs without bidirectional coverage are dropped (peripheral countries can therefore float without strong attachment, which is a known limitation). Logarithmic weighting on `n_A` and `n_B` prevents single high-volume relationships from dominating the force simulation.

### Directed affinity (Mode III)

UP/DOWN reads `delta_tone(other -> focal)` directly. The radial distance is set by a 5-band schedule:

| Affinity tier | Distance multiplier |
| --- | --- |
| Strong positive (greater than +2) | 1.0 (tight cluster) |
| Mild positive (+1 to +2) | 1.5 |
| Neutral (-1 to +1) | 2.0 |
| Mild negative (-2 to -1) | 4.5 |
| Strong negative (less than -2) | 8.5 (outer ring) |

Countries without directed coverage of the focal default to the neutral band.

### Compare intensity

Each Compare line's brightness is computed as:

```
intensity = max(|sym| / 1.5, log(count + 1) / 4 * 0.6) * 0.75 + 0.25
```

The first term boosts strong-affinity pairs; the second term boosts high-volume pairs. The combination keeps low-confidence baseline pairs dim, drawing the eye to the strong signals.

## Methodology and limitations

The project documents its limitations openly in an in-app Methodology modal. The most important limitations:

**Tone is noisy.** GDELT's tone signal blends linguistic sentiment, topic valence, and editorial bias. The `delta_tone` correction removes the topic-level baseline but does not remove linguistic-style differences across languages and outlets. Colors should be read as directional indicators, not precise measurements.

**Reporter attribution is biased.** Roughly 13 percent of GDELT records survive the country attribution step (URL TLD plus a curated lookup for generic `.com` and `.org` domains). The kept set skews toward English-language Western media. Russian, Chinese, Arabic, and many regional outlets are systematically underrepresented. Conclusions drawn here are conclusions about the visible-to-Western-Internet news ecosystem, not about global media.

**Sports coverage is thin.** GDELT's theme taxonomy does not strongly tag sports content. Even during Olympics week, the retained sports count is low (151 rows total versus 19,024 politics and 9,432 science). Use sports as a trend indicator, not a comprehensive picture.

**The data window is short.** Only 21 days are loaded, chosen for thematic contrast rather than continuous coverage. Time-series claims should be modest.

**Cross-border elevation spill (Mode I only).** The heightfield is continuous, so a country's signal influences vertices slightly beyond its actual territory. This is a small geographic lie traded for a readable landscape; if strict per-country boundaries are needed, switch to the basemap-only view (Elevation toggle off).

## Tech stack

* **Three.js** for WebGL rendering, scene management, and orbit controls.
* **Vanilla JavaScript** in four ES modules. No framework, no transpiler, no bundler.
* **Plain JSON** for data. No database, no server, no API (the raw dataset has been processed beforehand).
* **SVG** for the in-modal charts (tone distribution, timeline, target bars).
* **CSS custom properties** for the design tokens (tone palette, accent color, background ramps).

Fonts:

* Fraunces for display.
* JetBrains Mono for tags, labels, and numerical readouts.

## Browser support

Mobile is not currently supported. The UI assumes a mouse with modifier keys and a non-trivial screen.

## Known limitations and roadmap

Things the project does not currently do, in rough order of impact:

* **Coverage gaps in the source dataset.** GDELT only ingests countries whose outlets publish online in indexable form, 
so closed or low-internet-presence media ecosystems (notably North Korea, parts of Central Asia, much of Sub-Saharan Africa) 
are absent from the dataset regardless of their actual news production.
* **No mobile support.** Touch interaction is not implemented.
* **No automated tests.** This is a personal data-visualization project rather than production software.
* **UP/DOWN constants are hand-tuned.** The repair-pass parameters (`BASELINE=70`, `STEPS=350`, `REPAIR_PASSES=80`) work for the current dataset shape. A larger or differently-distributed dataset would need re-tuning.

## Acknowledgements

* **GDELT Project** for the open Global Knowledge Graph dataset.
* **Three.js** for the rendering library.

## License

This project is released under the MIT License unless otherwise specified in a separate `LICENSE` file at the repository root. Data from GDELT is subject to GDELT's own terms; see https://www.gdeltproject.org/ for details.
