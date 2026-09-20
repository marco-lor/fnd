import React, { memo, useCallback } from 'react';
import { computeValue } from '../../common/computeFormula';
import { AddSpellButton } from '../../dmDashboard/elements/buttons/addSpell';

// Clone only ancestors on the edited path; untouched fields keep their identity.
export function editorFormReducer(state, { path, value }) {
    const keys = Array.isArray(path) ? path : path.split('.');
    const update = (node, index) => {
        if (index === keys.length) return value;
        const key = keys[index];
        const child = update(node?.[key], index + 1);
        if (Object.is(node?.[key], child)) return node;
        const result = Array.isArray(node) ? [...node] : { ...node };
        result[key] = child;
        return result;
    };
    return update(state, 0);
}

export function useEditorFormActions(setForm) {
    const change = useCallback((path, value) => {
        setForm(previous => editorFormReducer(previous, { path, value }));
    }, [setForm]);
    const changeParameter = useCallback((category, field, level, value) => {
        change(['Parametri', category, field, level], value);
    }, [change]);
    return { change, changeParameter };
}

export const EditorAddSpellButton = memo(AddSpellButton);
const levels = ['1', '4', '7', '10'];
export const EditorParameterTable = memo(function EditorParameterTable({ title, schemaCategory, paramCategory, values, userParams, onChange, sorted = false, excludeArrays = false }) {
    const fields = Object.keys(schemaCategory || {}).filter(field => !excludeArrays || !Array.isArray(schemaCategory[field]));
    if (sorted) fields.sort();
    if (!fields.length) return null;
    return (
        <div className="w-full bg-gray-800/70 p-4 rounded-xl shadow-lg backdrop-blur-sm border border-gray-700/50">
            <h3 className="text-white mb-3 font-medium">{title}</h3>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[300px] text-white text-sm">
                    <thead>
                        <tr>
                            <th className="bg-gray-700/50 px-2 py-2 rounded-tl-lg text-left font-semibold">Param</th>
                            {levels.map((lvl, i) => (
                                <th key={lvl} className={`bg-gray-700/50 px-2 py-2 ${i === levels.length - 1 ? 'rounded-tr-lg' : ''} text-center font-semibold`}>
                                    Lvl {lvl}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map((field, i) => {
                            const isLastRow = i === fields.length - 1;
                            const rowData = values?.[field];
                            return (
                                <tr key={`${paramCategory}-${field}`}>
                                    <td className={`bg-gray-700/30 px-2 py-1.5 ${isLastRow ? 'rounded-bl-lg' : ''} text-left`}>{field}</td>
                                    {levels.map((lvl, j) => {
                                        const value = (rowData && rowData[lvl] !== undefined) ? rowData[lvl] : '';
                                        const isComputableParam = (paramCategory === 'Base' || paramCategory === 'Combattimento');
                                        const computed = isComputableParam && value && userParams ? computeValue(value, userParams) : null;
                                        return (
                                            <td key={lvl} className={`bg-gray-700/30 px-1 py-1 ${isLastRow && j === levels.length - 1 ? 'rounded-br-lg' : ''}`}>
                                                <div className="flex items-center justify-center">
                                                    <input
                                                        type="text"
                                                        value={value}
                                                        onChange={(e) => onChange(paramCategory, field, lvl, e.target.value)}
                                                        className="w-16 p-1 rounded-md bg-gray-600/70 text-white text-center focus:outline-none focus:ring-1 focus:ring-blue-500/50 border border-gray-500/50"
                                                        placeholder="-"
                                                    />
                                                    {computed !== null && !isNaN(computed) && (
                                                        <span className="ml-1 text-gray-400 text-xs">({computed})</span>
                                                    )}
                                                </div>
                                            </td>
                                        )
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
