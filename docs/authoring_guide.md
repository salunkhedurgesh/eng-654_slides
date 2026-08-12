# Authoring guide

## Layouts

Use these reusable classes:

- `layout-center`
- `layout-two-column`
- `layout-three-column`
- `layout-40-60`
- `layout-60-40`
- `layout-full`
- `layout-visual-full`

Modifiers:

- `tight-gap`, `medium-gap`, `loose-gap`
- `divided`
- `bleed-right`, `bleed-left`
- `shift-up`, `shift-left`, `shift-right`

## Figures

Use `technical-figure` for plots, diagrams, equations-as-images, and CAD screenshots where the entire image must remain visible.

Use `photo` for photographs where cropping is acceptable.

## Equations

MathJax is enabled. Use:

```html
<p>Inline math: \(q \in \mathbb{R}^n\).</p>

<div class="equation">
\[
T(q)=e^{[S_1]q_1}\cdots e^{[S_n]q_n}M
\]
</div>
```

## Step-by-step reveals

Add `reveal-children` to a grid/flex container:

```html
<div class="layout-three-column reveal-children">
  <div>Step 1</div>
  <div>Step 2</div>
  <div>Step 3</div>
</div>
```

In deck mode, arrow/space reveals each child before advancing the slide.

## 2D robot visualization

```html
<div data-robot2r data-q1="45" data-q2="60" data-trace="true"></div>
```

The 2D math convention is y-up. Internally, the visualizer flips y only at drawing time.

## 3D revolute joint demo

```html
<div data-three-revolute></div>
```

The 3D robotics convention is z-up. The module creates a root group rotated by `-Math.PI/2` about x.
