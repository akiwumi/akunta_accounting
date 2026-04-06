# Design System Document

## 1. Overview & Creative North Star: "AKUNTA"

The North Star for this design system is **AKUNTA**. In a sector dominated by rigid spreadsheets and cold blue gradients, we move toward a space that feels curated, bespoke, and profoundly calm. Accounting is often chaotic; the interface must be the antidote.

By drawing inspiration from the editorial elegance of *mira-inc.jp*, we replace the "utility-first" look with an **Editorial Financial** aesthetic. This system breaks the "template" look through intentional asymmetry, generous white space, and a high-contrast typographic scale. We treat data not as a burden, but as a fine art, using layered surfaces and sophisticated transitions to guide the user through complex financial narratives.

---

## 2. Colors: Tonal Depth & The "No-Line" Rule

Our palette is a sophisticated blend of muted minerals and soft atmospheric tones. It is designed to reduce eye strain during long periods of data entry while maintaining an air of premium authority.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders for sectioning are strictly prohibited. Boundaries must be defined solely through:
1.  **Background Color Shifts:** Placing a `surface-container-low` section against a `surface` background.
2.  **Subtle Tonal Transitions:** Using the hierarchy of surfaces to imply containment.
3.  **Negative Space:** Using the spacing scale to create "invisible" gutters that separate data sets.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine paper or frosted glass.
*   **Base:** `surface` (#faf9f6) - The foundation of the "Atelier."
*   **Low Elevation:** `surface-container-low` (#f4f3f0) - Used for primary workspace backgrounds.
*   **High Elevation:** `surface-container-highest` (#e3e2df) - Reserved for active sidebars or tertiary navigation.
*   **The Nesting Principle:** To highlight a specific ledger or report, place a `surface-container-lowest` (#ffffff) card on top of a `surface-container` (#efeeeb) section.

### Glass & Gradient Accents
To move beyond a flat "SaaS" feel:
*   **Glassmorphism:** Use `surface-variant` with a 60% opacity and `backdrop-blur: 20px` for floating modals or global navigation headers. This integrates the UI into the background.
*   **Signature Textures:** For primary CTAs (e.g., "Generate Report"), apply a subtle linear gradient from `primary` (#364244) to `primary-container` (#4d595b). This adds a "soul" and tactile quality that flat hex codes cannot achieve.

---

## 3. Typography: Editorial Authority

The typography system uses a sharp contrast between **Noto Serif** (our editorial voice) and **Manrope** (our functional voice) to create a rhythm that feels both classic and high-tech.

*   **Display & Headlines (`notoSerif`):** Used for large balance amounts and section titles. This provides a sense of established trust and premium quality.
    *   *Example:* `display-lg` (3.5rem) should be used for the total net profit on a dashboard, making the number feel like a statement of success.
*   **Titles & Body (`manrope`):** Our workhorse. Manrope's geometric clarity ensures that financial tables remain legible and modern. 
*   **Labels (`inter`):** Used for micro-copy and metadata. By switching to Inter for the smallest scales, we ensure maximum legibility for complex tax codes and line-item details.

---

## 4. Elevation & Depth: Tonal Layering

We reject the "drop shadow" defaults of the early 2010s. Depth is achieved through light and atmospheric layering.

### Ambient Shadows
If a "floating" element (like a context menu) is required, use **Ambient Shadows**:
*   **Blur:** 40px - 60px.
*   **Opacity:** 4% - 6% of the `on-surface` color.
*   **Color Tint:** Shadows should never be pure black; they must be tinted with our `primary` hue to feel like natural light passing through a translucent object.

### The "Ghost Border" Fallback
In scenarios where accessibility requires a physical container (e.g., high-contrast mode), use a **Ghost Border**:
*   `outline-variant` (#c3c7c8) at **15% opacity**. This creates a "suggestion" of a boundary rather than a hard wall.

---

## 5. Components: The Refined Primitives

### Buttons
*   **Primary:** A soft gradient of `primary` to `primary-container`. `0.25rem` (default) roundedness. No border. Text in `on-primary`.
*   **Secondary:** `surface-container-highest` background with `on-surface` text. Feels integrated into the page.
*   **Tertiary:** No background. `title-sm` typography with an underline that appears only on hover.

### Input Fields & Data Entry
*   **The Flat Input:** Background `surface-container-lowest` (#ffffff) with a 2px bottom-only stroke of `secondary-container` (#c5eae7).
*   **Focus State:** The bottom stroke transitions to `primary` (#364244) with a subtle vertical "lift" animation of the label.

### Cards & Lists
*   **Forbid Divider Lines:** Lists must be separated by 16px or 24px of white space. For financial tables, use alternating row colors (Zebra striping) using `surface-container-lowest` and `surface-container-low` rather than horizontal rules.

### Specialized Financial Components
*   **The Tonal Ledger:** A container for transactions using `surface-container-lowest`. Each row should have a `0.5s` fade-in animation on scroll to emphasize the "bespoke" nature of the data.
*   **Metric Micro-Charts:** Use `secondary` (#426462) for positive trends and `error` (#ba1a1a) for negative. Lines should be thin (1.5px) and anti-aliased.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical layouts (e.g., a left-aligned headline with a right-aligned data table shifted 40px off-center) to create an editorial feel.
*   **Do** prioritize "Breathing Room." Financial data is dense; the UI should be the oxygen.
*   **Do** use `notoSerif` for large numbers to lend them weight and "financial gravity."

### Don't
*   **Don't** use 100% opaque borders. They clutter the visual field and make the software feel "cheap."
*   **Don't** use standard "Success Green." Use our `secondary` (#426462) for a more professional, muted teal that conveys stability rather than a generic "alert."
*   **Don't** use fast, "snappy" animations. Transitions should be ease-in-out and slightly slower (300ms-500ms) to mimic the deliberate movement of a premium brand.

---

## 7. Motion & Interaction
Animations should feel like a page turn in a high-end magazine.
*   **Page Transitions:** A subtle `y-axis` slide (20px) combined with a fade-in.
*   **Hover States:** Instead of changing color, high-end components should slightly "glow" using an increase in the ambient shadow spread or a shift from `surface-container` to `surface-container-lowest`.