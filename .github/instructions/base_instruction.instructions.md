# AI Custom Instructions

## Terminal Command Guidelines for Windows PowerShell

**IMPORTANT: When working with Windows PowerShell terminal commands, follow these guidelines:**

### Command Chaining Syntax
- **DO NOT USE** `&&` syntax for chaining commands (e.g., `npm install && npm start`)
- **ALWAYS USE** `;` (semicolon) for command chaining instead (e.g., `npm install; npm start`)
- **REASON**: The `&&` operator produces errors in VS Code's integrated PowerShell terminal on Windows

### Correct Command Examples
```powershell
# ✅ CORRECT - Use semicolon for chaining
npm install; npm start
cd backend; python -m pip install -r requirements.txt
git add .; git commit -m "update"; git push

# ❌ INCORRECT - Avoid && syntax
npm install && npm start
cd backend && python -m pip install -r requirements.txt
git add . && git commit -m "update" && git push
```

### Multi-line Commands
When providing multi-line terminal commands, prefer separate command calls rather than chaining:
```powershell
# ✅ PREFERRED - Separate commands
npm install
npm start

# ✅ ACCEPTABLE - Semicolon chaining
npm install; npm start
```

### Error Handling in PowerShell
- Use `if ($?) { ... }` for conditional execution instead of `&&`
- Use `try { ... } catch { ... }` blocks for more complex error handling

### General Terminal Best Practices
1. Always use absolute paths when possible
2. Quote paths with spaces using double quotes
3. Test commands in a safe environment first
4. Use `Get-Command` to verify command availability
5. Use `Get-Help <command>` for command documentation

## Project Context
This is a D&D-like web application with:
- **Frontend**: React.js with Tailwind CSS
- **Backend**: Python FastAPI
- **Database**: Firebase/Firestore
- **Environment**: Windows development with VS Code

## Development Workflow
When making changes:
1. Navigate to appropriate directory (frontend/ or backend/)
2. Make necessary code changes
3. Test locally before deploying
4. Use proper Git workflow for version control

## File Structure Awareness
- Frontend React components are in `frontend/src/components/`
- Backend API is in `backend/`
- Firebase configuration is in `frontend/src/components/firebaseConfig.js`
- Common utilities are in `frontend/src/components/common/`

Remember: Always use semicolon (`;`) syntax instead of `&&` for terminal command chaining in this Windows PowerShell environment.