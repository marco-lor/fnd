# Navbar and Layout Architecture

This document describes the authenticated application shell after the left-sidebar redesign.

## 1. Overview

Authenticated routes now render inside a shared app shell composed of:

1. `GlobalAuroraBackground`
2. `GlobalGrigliataMusicPlayer`
3. a shared navigation shell from `Layout`
4. route content rendered inside the shell content area

The shell keeps navigation behavior centralized while exposing layout metrics to pages that need sticky offsets or viewport-aware workspace sizing.

## 2. Navbar Component

**Location:** `frontend/src/components/common/navbar.js`

The `Navbar` export now renders two variants:

- **Desktop (`xl+`)**: a persistent left sidebar
- **Mobile / tablet (`< xl`)**: a compact top utility bar plus an overlay drawer

### Desktop sidebar

- Uses a persistent width controlled by shell state.
- Expanded width is `16rem`.
- Collapsed width is `5.5rem`.
- Collapse state is persisted in local storage under `layout.sidebarCollapsed`.
- Collapsed mode shows navigation icons only; labels remain available through accessibility attributes and tooltips.

### Mobile shell

- Renders a top utility bar with the current route label, avatar, and menu trigger.
- Opens a `16rem` left drawer with the same navigation, profile actions, and logout action.
- The drawer closes on:
  - backdrop click
  - `Escape`
  - route navigation

### Shared behavior

- Navigation uses `NavLink`.
- Role-gated items still apply exactly as before:
  - DMs see `DM Dashboard` and `Foes Hub`
  - Webmasters see `Admin`
- Profile image preview/upload remains in the shared navigation shell.
- Logout still signs out through Firebase Auth and redirects to `/`.

## 3. Layout Component

**Location:** `frontend/src/components/common/Layout.js`

`Layout` now wraps authenticated pages with `ShellLayoutProvider`.

### Shell structure

```jsx
<ShellLayoutProvider>
  <div style={{ '--app-shell-nav-width': ..., '--app-shell-top-inset': ... }}>
    <GlobalAuroraBackground />
    <GlobalGrigliataMusicPlayer />
    <div className="shell">
      <Navbar />
      <main>{children}</main>
    </div>
  </div>
</ShellLayoutProvider>
```

### Layout metrics contract

The shell provider exposes `useShellLayout()` with:

- `isNavCollapsed`
- `toggleNav`
- `isMobileNavOpen`
- `openMobileNav`
- `closeMobileNav`
- `navInlineSize`
- `topInset`

The layout also mirrors those metrics onto CSS variables:

- `--app-shell-nav-width`
- `--app-shell-top-inset`

`navInlineSize` is the inline width consumed by the desktop sidebar. On mobile it is `0`.

`topInset` is the vertical space reserved for the mobile top utility bar. On desktop it is `0`.

## 4. Page Integration

Pages that previously measured `[data-navbar]` directly now consume shell metrics through `useShellLayout()`.

Current shell-aware consumers include:

- `GrigliataPage`
- `EchiDiViaggio`
- `Bazaar`
- `CombatPage`
- `Codex`
- `DMDashboard`

These pages use `topInset` for sticky offsets and workspace height calculations, which keeps them aligned with both the desktop sidebar shell and the mobile drawer/top-bar shell.
