# Navbar and Layout Architecture

This document describes the implementation and relationship between the Navbar, the main Layout component, and the top section of the pages in the frontend application.

## 1. Overview

The application uses a centralized `Layout` component to ensure a consistent look and feel across most authenticated pages. This layout manages the positioning of the `Navbar`, the background effects, and the main page content.

## 2. Navbar Component

**Location:** `frontend/src/components/common/navbar.js`

The Navbar is the primary navigation element. It is designed to be always visible (sticky) and adapts based on the user's role and current route.

### Structure
The component renders a `<nav>` element with a 3-column grid layout:
1.  **Left (User Profile):** Displays the user's avatar, name, race, and level. It includes functionality for uploading and previewing the profile image.
2.  **Center (Navigation):** Contains navigation buttons (Home, Bazaar, Combat, etc.).
3.  **Right (Actions):** Contains the Logout button.

### Styling & Positioning
-   **Sticky Positioning:** Uses `sticky top-0` to remain at the top of the viewport during scrolling.
-   **Z-Index:** Uses `z-50` to ensure it floats above all other page content.
-   **Visuals:** Uses a semi-transparent background (`bg-[rgba(40,40,60,0.8)]`) with `backdrop-blur-sm` to create a glass-morphism effect over the scrolling content.

### Logic & Behavior
-   **Routing:** Uses `useNavigate` for page transitions.
-   **Active State:** Uses `useLocation` to detect the current path. The active button is highlighted (e.g., `bg-[#FFA500]`), while inactive buttons remain transparent.
-   **Role-Based Rendering:**
    -   **DMs:** See additional buttons for "DM Dashboard" and "Foes Hub".
    -   **Webmasters:** See an "Admin" button.
    -   **Standard Users:** See the standard set of player tools.

## 3. Layout Component

**Location:** `frontend/src/components/common/Layout.js`

The `Layout` component acts as the wrapper for most pages in the application. It orchestrates the stacking context and structural relationship between the background, the navbar, and the page content.

### Composition
The Layout renders elements in the following order:
1.  **`GlobalAuroraBackground`:** A fixed background effect rendered at the lowest z-index.
2.  **`Navbar`:** Rendered at the top of the flex container.
3.  **`children`:** The specific page content passed to the Layout, rendered immediately below the Navbar.

```jsx
// Conceptual Structure
<div className="min-h-screen flex flex-col ...">
  <GlobalAuroraBackground />
  <Navbar />
  <main className="flex-grow ...">
    {children}
  </main>
</div>
```

## 4. Interaction with Page Content ("Top Part")

The "top part of the page" refers to how the content interacts with the Navbar immediately upon rendering.

### Standard Pages (e.g., Home, Bazaar)
-   **Container:** These pages are wrapped in the `Layout` component.
-   **Flow:** Because the Navbar is `sticky` (not `fixed` in a way that removes it from flow) and part of the flex column, the page content naturally starts *below* the Navbar.
-   **Overlap:** The Navbar's `z-50` ensures that if the page content scrolls up, it slides *underneath* the semi-transparent Navbar.

### Standalone Pages (e.g., CharacterCreation)
-   **Exception:** The `CharacterCreation` page does **not** use the `Layout` component.
-   **Structure:** It defines its own container and header structure, independent of the main application navigation.

## 5. Data Flow & State

There is no direct prop drilling between the Navbar and the pages. Instead, synchronization is handled via Context:

-   **`AuthContext`:** Both the Navbar (for profile info) and the Pages (for content logic) subscribe to `AuthContext`. This ensures that if a user updates their character data or levels up on a page, the Navbar reflects these changes immediately without complex parent-child communication.
