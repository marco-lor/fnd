import { editorFormReducer } from './editorForm';

test('nested edit preserves siblings and the immutable input, and identical edits are no-ops', () => {
 const base = Object.freeze({Forza: Object.freeze({'1': '17', '4': '18'})});
 const combat = Object.freeze({Attacco: Object.freeze({'1': '6'})});
 const state = Object.freeze({General: Object.freeze({Nome: 'Sword'}), Parametri: Object.freeze({Base: base, Combattimento: combat})});
 const next = editorFormReducer(state, {path: ['Parametri', 'Base', 'Forza', '1'], value: '42'});
 expect(next.Parametri.Base.Forza).toEqual({'1': '42', '4': '18'});
 expect(next.General).toBe(state.General);
 expect(next.Parametri.Combattimento).toBe(combat);
 expect(state.Parametri.Base.Forza['1']).toBe('17');
 expect(editorFormReducer(next, {path: ['Parametri', 'Base', 'Forza', '1'], value: '42'})).toBe(next);
});

test('list row edits and missing paths preserve unrelated identities', () => {
 const first = Object.freeze({selectedTec: 'A', ridValue: '2'});
 const second = Object.freeze({selectedTec: 'B', ridValue: '3'});
 const rows = Object.freeze([first, second]);
 const next = editorFormReducer(rows, {path: [0, 'ridValue'], value: '4'});
 expect(next).toEqual([{selectedTec: 'A', ridValue: '4'}, second]);
 expect(next[1]).toBe(second);
 expect(first.ridValue).toBe('2');
 expect(editorFormReducer({}, {path: 'General.Nome', value: 'New'})).toEqual({General: {Nome: 'New'}});
});
