# FND (Fantasy & Dragons) - D&D-like Web Application

## Project Overview

FND is a comprehensive web-based role-playing game application inspired by Dungeons & Dragons. The project provides a complete digital platform for players and dungeon masters to create characters, manage campaigns, and interact in a fantasy gaming environment.

## Technology Stack

### Frontend
- **Framework**: React 18 with JavaScript
- **Routing**: React Router DOM v7
- **Styling**: CSS, Tailwind CSS, Styled Components
- **UI/Animation**: 
  - Framer Motion for animations
  - Three.js and React Three Fiber for 3D graphics
  - Konva and React-Konva for 2D canvas interactions
  - FontAwesome icons
- **State Management**: React Context API (AuthContext)
- **Build Tool**: Create React App

### Backend
- **API Framework**: FastAPI (Python)
- **Database**: Google Cloud Firestore (NoSQL)
- **Cloud Functions**: Firebase Functions (TypeScript)
- **Authentication**: Firebase Authentication
- **File Storage**: Firebase Storage
- **Deployment**: 
  - Frontend: Firebase Hosting
  - Backend: Render

### Additional Libraries
- **Dice Rolling**: threejs-dice
- **Expression Evaluation**: expr-eval
- **HTTP Client**: Axios

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   React Frontend │    │   FastAPI Backend │    │   Firebase Services │
│   (Firebase      │    │   (Render)        │    │   - Firestore DB    │
│    Hosting)      │    │                   │    │   - Authentication  │
│                  │    │                   │    │   - Storage         │
│                  │    │                   │    │   - Cloud Functions │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
```

## Core Features

### 1. User Management & Authentication
- Email/password authentication via Firebase Auth
- Role-based access control (Player, DM, Webmaster)
- Real-time user data synchronization
- Profile image management

### 2. Character Creation System
- Multi-step character creation wizard
- Race selection with racial bonuses
- Anima Shard system for magical abilities
- Statistical point distribution
- Character details and customization

### 3. Game Mechanics
- **Character Statistics**:
  - Base Parameters (Forza, Destrezza, Costituzione, etc.)
  - Combat Parameters (Attacco, Difesa, Disciplina, etc.)
  - HP/Mana management with real-time updates
- **Point System**:
  - Base points for character creation
  - Combat tokens for combat abilities
  - Automated validation and constraints

### 4. Game Modules
- **Home Dashboard**: Character overview and quick stats
- **Bazaar**: Item marketplace and inventory management
- **Combat Tool**: Battle management system
- **Codex**: Game rules and reference materials
- **Spell/Technique System**: Magical abilities management
- **Echi di Viaggio**: Campaign/story elements

### 5. Administrative Tools
- **DM Dashboard**: Player management and campaign tools
- **Admin Panel**: User role management (Webmaster only)
- **Lock System**: DM can lock/unlock player parameter editing

## Data Flow Architecture

### 1. Authentication Flow
```
User Login → Firebase Auth → AuthContext → Real-time User Data Sync → Route Protection
```

### 2. Character Creation Flow
```
New User → Firebase Auth → Character Creation Wizard → Firestore Data Creation → Home Dashboard
```

### 3. Real-time Data Updates
```
User Action → Firebase Functions/Direct Firestore → Real-time Listeners → UI Updates
```

### 4. Parameter Management Flow
```
Stat Change Request → Validation → Cloud Function → Firestore Update → Real-time Sync → UI Reflection
```

## Database Structure (Firestore)

### Collections:

#### `users/{userId}`
```json
{
  "characterId": "string",
  "email": "string",
  "role": "player|dm|webmaster",
  "imageUrl": "string",
  "race": "string",
  "Parametri": {
    "Base": {
      "Forza": {"Base": 0, "Bonus": 0, "Tot": 0},
      "Destrezza": {...},
      // ... other base stats
    },
    "Combattimento": {
      "Attacco": {"Base": 0, "Bonus": 0, "Tot": 0},
      "Difesa": {...},
      // ... other combat stats
    }
  },
  "stats": {
    "level": 1,
    "hpTotal": 0,
    "hpCurrent": 0,
    "manaTotal": 0,
    "manaCurrent": 0,
    "basePointsAvailable": 4,
    "basePointsSpent": 0,
    "combatTokensAvailable": 50,
    "combatTokensSpent": 0
  },
  "flags": {
    "characterCreationDone": boolean
  },
  "settings": {
    "lock_param_base": boolean,
    "lock_param_combat": boolean
  },
  "inventory": {...},
  "spells": {...},
  "tecniche": {...},
  "conoscenze": {...},
  "professioni": {...}
}
```

#### `items/{itemId}`
- Marketplace items with stats and effects

#### `utils/`
- `schema_pg`: Character template schema
- `possible_lists`: Available options (races, roles, etc.)
- `varie`: Game configuration (combat costs, etc.)

## Cloud Functions

### Automated Functions (Firebase Functions)
- **updateHpTotal**: Recalculates HP when Costituzione changes
- **updateManaTotal**: Recalculates Mana when Disciplina changes
- **updateTotParameters**: Updates total parameter values when base/bonus change
- **updateAnimaModifier**: Manages Anima-based bonuses
- **spendCharacterPoint**: Handles point spending with validation
- **deleteUser**: Admin function for user deletion

### API Endpoints (FastAPI)
- Character CRUD operations
- Data manipulation utilities
- Integration endpoints for frontend communication

## Security & Permissions

### Role-Based Access Control
- **Player**: Standard character management
- **DM**: Player oversight, lock controls, campaign management
- **Webmaster**: Full administrative access, user management

### Data Validation
- Client-side validation for immediate feedback
- Server-side validation in Cloud Functions
- Firestore security rules for data protection

## Deployment Architecture

### Frontend (Firebase Hosting)
- Production URL: `https://fatins.web.app`
- Automatic builds from repository
- CDN distribution for global performance

### Backend (Render)
- Production URL: `https://fnd-64ts.onrender.com`
- Auto-scaling FastAPI service
- Environment-based configuration

### Database (Firestore)
- Multi-region deployment (europe-west8)
- Real-time synchronization
- Automatic backups

## Development Workflow

### Local Development
- Frontend: `npm start` (localhost:3000)
- Backend: `uvicorn main:app --reload` (localhost:8000)
- Firebase emulators for local testing

### Deployment
- Frontend: `npm run build` → `firebase deploy`
- Backend: Automatic deployment via Render GitHub integration
- Functions: Deployed via Firebase CLI

## Key Design Patterns

### 1. Real-time Data Synchronization
- Uses Firestore listeners for immediate UI updates
- Optimistic UI updates with server validation
- Caching strategies for performance

### 2. Component Architecture
- Modular component structure
- Reusable UI components in `common/`
- Feature-based organization

### 3. State Management
- AuthContext for global user state
- Local component state for UI interactions
- Firestore as single source of truth

### 4. Error Handling
- Comprehensive error boundaries
- User-friendly error messages
- Logging for debugging

## Future Enhancements

- Enhanced 3D visualization
- Real-time multiplayer sessions
- Advanced combat mechanics
- Mobile application
- AI-powered game assistance

---

*This project represents a comprehensive digital transformation of traditional tabletop RPG mechanics into a modern, scalable web application.*
