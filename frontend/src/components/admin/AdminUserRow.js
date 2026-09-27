import React, { memo } from 'react';

export const AdminUserRow = ({ user, roles, actorUid, pending, error, onRoleChange, onDelete }) => (
  <tr className="border-b border-gray-700" data-testid={`admin-row-${user.id}`}>
    <td className="px-4 py-2">{user.characterId || 'N/A'}</td>
    <td className="px-4 py-2">{user.username || 'N/A'}</td>
    <td className="px-4 py-2">{user.email || 'N/A'}</td>
    <td className="px-4 py-2">{user.role || 'N/A'}</td>
    <td className="px-4 py-2">
      <select aria-label={`Ruolo ${user.id}`} value={roles.includes(user.role) ? user.role : ''}
        disabled={Boolean(pending) || user.id === actorUid}
        onChange={(event) => onRoleChange(user.id, event.target.value)}
        className="bg-gray-700 rounded p-2">
        <option value="" disabled>Seleziona...</option>
        {roles.map((role) => <option key={role} value={role}>{role}</option>)}
      </select>
      {pending && <span role="status" className="ml-2">{pending === 'role' ? 'Aggiornamento...' : 'Eliminazione...'}</span>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </td>
    <td className="px-4 py-2"><button disabled={Boolean(pending) || user.id === actorUid}
      onClick={() => onDelete(user)} className="bg-red-700 rounded px-3 py-1 disabled:opacity-50">Elimina</button></td>
  </tr>
);
export default memo(AdminUserRow);
